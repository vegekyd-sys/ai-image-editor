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
  providerKey,
  fetcher = fetch,
  organize = organizeVoice,
}) {
  const shows = createSessions(directory);
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
          return json(200, { ...shows.present(s), playerPath: playerPath(s) });
        }
        const s = shows.owned(body.id, actor);
        if (body.action === 'direct')
          return json(
            200,
            await shows.input(
              s,
              { text: body.text, turnId: body.turnId ?? randomUUID(), host: body.host === true },
              organize,
            ),
          );
        if (body.action === 'stop') shows.stop(s.id);
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
        if (!shows.alive(s)) return json(200, shows.present(s));
        shows.receipt(s, body);
        return json(200, {
          ...shows.present(shows.current(s.id)),
          config: JSON.parse(s.config),
          directions: shows.changes(s, body.after ?? 0),
        });
      }
      if (op === 'stop') {
        shows.stop(s.id);
        return json(200, { stopped: true });
      }
      if (!shows.alive(s)) fail(409, '直播已结束');
      if (op === 'activity') {
        shows.activity(s);
        return json(200, { ok: true });
      }
      if (op === 'input')
        return json(
          200,
          await shows.input(s, { text: body.text, turnId: body.turnId, host: false }, organize),
        );
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
      const upstream = await fetcher(target, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: 'Key ' + providerKey, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(90000),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        if (target === bridge + '/session') shows.stop(s.id, 'failed');
        fail(424, 'Director 信令失败 HTTP ' + upstream.status);
      }
      const result = await upstream.json();
      if (target === bridge + '/session') shows.connected(s.id, result.session_id);
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
