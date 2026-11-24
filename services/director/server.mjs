import { attachVoiceServer } from './voice-asr.mjs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, link, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createSessions, fail } from './sessions.mjs';
import { organizeVoice } from '../../src/lib/director/organizer.mjs';
import { createShowrunner } from '../../src/lib/director/showrunner.mjs';

const endpoint = 'minimax/h3-max/director',
  bridge = 'https://wma.fal.run';
const signals = new Set([
  bridge + '/ice',
  bridge + '/session',
  bridge + '/session/heartbeat',
  'https://fal.run/' + endpoint + '/ice',
]);
async function jsonBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 128 * 1024) fail(413, '请求过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    fail(400, 'JSON 无效');
  }
}
export function createDirectorServer({
  directory,
  authenticate,
  activeKey,
  openingUpload,
  stageImage,
  providerKey,
  fetcher = fetch,
  organize = organizeVoice,
  maxSeconds = 120,
  showrunner = createShowrunner(),
}) {
  // A player waiting on a poll is woken as soon as its show gains a direction or ends.
  const waiting = new Map();
  const wake = (id) => {
    for (const resolve of waiting.get(id) ?? []) resolve();
    waiting.delete(id);
  };
  const changed = (id, ms) => new Promise((resolve) => {
    const set = waiting.get(id) ?? new Set();
    waiting.set(id, set.add(resolve));
    setTimeout(() => {
      set.delete(resolve);
      if (!set.size && waiting.get(id) === set) waiting.delete(id);
      resolve();
    }, ms).unref();
  });
  const shows = createSessions(directory, { maxMs: maxSeconds * 1000, onChange: wake });
  // Preparation belongs to one authenticated show. Only the player submits its WebRTC offer.
  const preparationByShow = new Map();
  const providerPost = (target, body, timeout) => fetcher(target, {
    method: 'POST',
    redirect: 'error',
    headers: {authorization: 'Key ' + providerKey, 'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  function prepare(show) {
    if (preparationByShow.has(show.id)) return;
    const pending = providerPost(bridge + '/ice', {app_id: endpoint}, 3500)
      .then(async response => {
        if (!response.ok) { await response.body?.cancel(); return null; }
        const {ice_servers: servers} = await response.json();
        return Array.isArray(servers) && servers.length ? servers : null;
      }).catch(() => null);
    const prep = { ice: pending, imageUrl: null };
    preparationByShow.set(show.id, prep);
    setTimeout(() => preparationByShow.delete(show.id), 30000).unref();
    const source = JSON.parse(show.config).image_url;
    if (source && stageImage) {
      Promise.resolve().then(() => stageImage(source)).then(url => { prep.imageUrl = url; }).catch(() => {});
    }
  }
  const playerPath = (s) => '/director/player.html#' + s.id + '.' + s.token;
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (
        req.method === 'GET' &&
        [
          '/director/player.html',
          '/director/player.js',
          '/director/transport.mjs',
          '/director/playout.mjs',
          '/director/voice.js',
          '/director/voice-state.js',
          '/director/voice-worklet.js',
        ].includes(url.pathname)
      ) {
        const file = url.pathname.split('/').at(-1),
          html = file.endsWith('html');
        res.setHeader(
          'content-type',
          html ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        );
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('cache-control', 'no-store');
        res.end(await readFile(new URL('./player/' + file, import.meta.url)));
        return;
      }
      if (req.method !== 'POST') fail(404, '没有这个接口');
      if (url.pathname === '/api/storage/upload-url' && openingUpload) {
        const actor = await authenticate(req.headers.authorization);
        if (!actor) fail(403, '需要已启用的 Makaron key');
        const { filename, contentType } = await jsonBody(req);
        if (
          typeof filename !== 'string' ||
          filename.length > 255 ||
          !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(contentType)
        )
          fail(400, '首图格式无效');
        const result = await openingUpload(
          req.headers.authorization,
          path.basename(filename),
          contentType,
        );
        if (!result.ok) fail(result.status, '无法上传首图');
        return json(200, await result.json());
      }
      if (url.pathname === '/api/director') {
        const actor = await authenticate(req.headers.authorization);
        if (!actor) fail(403, '需要本次 Preview 已启用的 Makaron key');
        const body = await jsonBody(req);
        if (body.action === 'start') {
          const s = shows.start(actor, body);
          if (s.phase === 'waiting') prepare(s);
          return json(200, { ...shows.present(s), playerPath: playerPath(s) });
        }
        const s = shows.owned(body.id, actor);
        if (body.action === 'direct') {
          const result = await shows.input(
            s,
            { text: body.text, turnId: body.turnId ?? randomUUID(), host: body.host === true, ready: body.ready === true },
            organize,
          );
          const sent = Number.isInteger(result.version) && shows.changes(s, result.version - 1)[0];
          if (sent) showrunner?.user(s.id, { version: sent.version, text: sent.text });
          return json(200, result);
        }
        if (body.action === 'stop') {
          shows.stop(s.id);
          showrunner?.end(s.id);
        }
        if (body.action === 'export') {
          if (!s.recording) fail(409, '录像还未保存');
          const file = path.join(directory, s.id + '.' + s.recording);
          res.writeHead(200, {
            'content-type': 'video/' + s.recording,
            'content-length': (await stat(file)).size,
            'cache-control': 'no-store',
          });
          await pipeline(createReadStream(file), res);
          return;
        }
        if (!['stop', 'status', 'open'].includes(body.action)) fail(400, '不支持的操作');
        return json(200, {
          ...shows.present(shows.current(s.id)),
          ...(body.action === 'open' ? { playerPath: playerPath(s) } : {}),
        });
      }
      if (!url.pathname.startsWith('/api/director/player/')) fail(404, '没有这个接口');
      const s = shows.viewer(url.searchParams.get('id'), req.headers['x-director-player']);
      if (!(await activeKey(s.key_id, s.owner))) {
        shows.stop(s.id);
        fail(403, '直播授权已停用');
      }
      const op = url.pathname.split('/').at(-1);
      if (op === 'recording') {
        if (!s.provider_session) fail(409, '本场尚无媒体连接');
        if (s.recording) return json(200, { saved: true });
        if (Date.now() > s.expires + 300_000) fail(410, '录制窗口已过期');
        const format =
          req.headers['content-type']?.split(';')[0] === 'video/mp4'
            ? 'mp4'
            : req.headers['content-type']?.split(';')[0] === 'video/webm'
              ? 'webm'
              : null;
        if (!format) fail(415, '无效录像格式');
        const target = path.join(directory, s.id + '.' + format),
          tmp = target + '.' + randomUUID() + '.part';
        let bytes = 0;
        try {
          await pipeline(
            req,
            new Transform({
              transform(chunk, enc, cb) {
                bytes += chunk.length;
                cb(bytes > 128 * 1024 * 1024 ? new Error('录像过大') : null, chunk);
              },
            }),
            createWriteStream(tmp, { mode: 0o600, flags: 'wx' }),
          );
          if (!bytes) fail(400, '录像为空');
          await link(tmp, target);
          shows.recording(s, format);
        } finally {
          await unlink(tmp).catch(() => {});
        }
        return json(200, { saved: true });
      }
      const body = await jsonBody(req);
      if (op === 'poll') {
        if (!shows.alive(s)) {
          showrunner?.end(s.id);
          return json(200, shows.present(s));
        }
        shows.receipt(s, body);
        const after = Number.isSafeInteger(body.after) ? body.after : 0;
        if (s.story && showrunner?.active(s.id)) {
          if (Number.isSafeInteger(body.playing) && body.playing <= s.version) showrunner.observe(s.id, body.playing);
          const beat = s.phase === 'connected' && showrunner.next(s.id, s.version, { busy: shows.drafting(s) });
          const version = beat && shows.append(s, { text: beat.prompt, caption: beat.caption });
          if (version) showrunner.sent(s.id, version, beat);
        }
        // Once the picture is live the player keeps one poll open, so a new direction goes out at once.
        if (s.phase === 'connected' && Number.isSafeInteger(body.wait) && body.wait > 0 && !shows.changes(s, after).length)
          await changed(s.id, Math.min(body.wait, 2000));
        const latest = shows.current(s.id);
        const prep = preparationByShow.get(s.id);
        const iceServers = body.prepare === true && latest.phase === 'waiting' ? await prep?.ice : null;
        return json(200, {
          ...shows.present(latest),
          config: JSON.parse(s.config),
          ...(iceServers ? {iceServers} : {}),
          ...(prep?.imageUrl && !latest.applied ? { preparedImageUrl: prep.imageUrl } : {}),
          directions: shows.alive(latest) ? shows.changes(s, after) : [],
        });
      }
      if (op === 'stop') {
        shows.stop(s.id);
        showrunner?.end(s.id);
        return json(200, { stopped: true });
      }
      if (!shows.alive(s)) fail(409, '直播已结束');
      if (op === 'activity') {
        shows.activity(s);
        return json(200, { ok: true });
      }
      if (op === 'input') {
        const result = await shows.input(s, { text: body.text, turnId: body.turnId, host: false }, organize);
        const sent = Number.isInteger(result.version) && shows.changes(s, result.version - 1)[0];
        if (sent) showrunner?.user(s.id, { version: sent.version, text: sent.text });
        return json(200, result);
      }
      if (op !== 'signal') fail(404, '没有这个接口');
      const target = req.headers['x-fal-target-url'];
      if (!signals.has(target)) fail(400, '无效信令目标');
      let request;
      if (target === bridge + '/session') {
        if (
          body.app_id !== endpoint ||
          body.type !== 'offer' ||
          typeof body.sdp !== 'string' ||
          !body.sdp
        )
          fail(400, '无效连接请求');
        shows.takeOffer(s);
        request = { app_id: endpoint, type: 'offer', sdp: body.sdp };
      } else if (target === bridge + '/session/heartbeat') {
        if (!s.provider_session || s.provider_session !== body.session_id) fail(409, '会话不匹配');
        request = { session_id: s.provider_session };
      } else request = target === bridge + '/ice' ? { app_id: endpoint } : {};
      const upstream = await providerPost(target, request, 90000);
      if (!upstream.ok) {
        await upstream.body?.cancel();
        // One more offer is allowed after a provider-side failure; a second failure ends the show.
        if (target === bridge + '/session' && !(upstream.status >= 500 && shows.reopen(shows.current(s.id))))
          shows.stop(s.id, 'failed');
        fail(424, 'Director 信令失败 HTTP ' + upstream.status);
      }
      const result = await upstream.json();
      if (target === bridge + '/session') {
        shows.connected(s.id, result.session_id);
        // Planning starts once the provider has answered, so it shares nothing with the
        // opening's negotiation, and is ready well before the opening has held on screen.
        if (s.story && showrunner) {
          // Shows whose player never came back to end them are dropped here.
          for (const other of showrunner.ids()) {
            let gone = true;
            try { gone = !shows.alive(shows.current(other)); } catch {}
            if (gone) showrunner.end(other);
          }
          const config = JSON.parse(s.config);
          showrunner.open(s.id, { premise: config.prompt, hasImage: Boolean(config.image_url) });
        }
      }
      return json(200, result);
    } catch (e) {
      if (!res.headersSent)
        json(e.status ?? 500, { error: e.status ? e.message : 'Director 暂时不可用' });
      else res.destroy();
    }
  });
  attachVoiceServer(server, {
    authorize: async (id, ticket) => {
      const s = shows.viewer(id, ticket);
      if (!(await activeKey(s.key_id, s.owner))) fail(403, '未授权');
      return () => shows.alive(shows.current(id));
    },
  });
  server.once('close', () => shows.close());
  return server;
}
