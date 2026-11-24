import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildDirectorConfigure } from '../../src/lib/director/director-state.mjs';

export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const MAX_MS = 120_000;
// An unfinished spoken direction holds the showrunner only while the speaker may still finish it.
export const DRAFT_HOLD_MS = 8000;

export function createSessions(directory, { now = Date.now, maxMs = MAX_MS, onChange = () => {} } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'sessions.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS shows(id TEXT PRIMARY KEY, owner TEXT NOT NULL, key_id TEXT NOT NULL,
      request_id TEXT NOT NULL, token TEXT NOT NULL, config TEXT NOT NULL, phase TEXT NOT NULL, expires INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0, draft TEXT NOT NULL DEFAULT '',
      provider_session TEXT, applied INTEGER NOT NULL DEFAULT 0, frames INTEGER NOT NULL DEFAULT 0,
      recording TEXT, UNIQUE(key_id,request_id));
    CREATE TABLE IF NOT EXISTS directions(show TEXT, version INTEGER, text TEXT NOT NULL, PRIMARY KEY(show,version));
    CREATE TABLE IF NOT EXISTS turns(show TEXT, id TEXT, result TEXT, PRIMARY KEY(show,id));`);
  // Why a show ended, for hosts that must explain it (time limit, failed negotiation, explicit stop).
  try { db.exec('ALTER TABLE shows ADD COLUMN end_reason TEXT'); } catch {}
  try { db.exec('ALTER TABLE shows ADD COLUMN offers INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Shows that a showrunner keeps moving, and which directions it wrote.
  try { db.exec('ALTER TABLE shows ADD COLUMN story INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE directions ADD COLUMN caption TEXT'); } catch {}
  try { db.exec("ALTER TABLE directions ADD COLUMN source TEXT NOT NULL DEFAULT 'user'"); } catch {}
  try { db.exec('ALTER TABLE shows ADD COLUMN draft_at INTEGER NOT NULL DEFAULT 0'); } catch {}
  const read = (id) => db.prepare('SELECT * FROM shows WHERE id=?').get(id) ?? fail(404, '没有这场直播');
  const alive = (s) => s.expires > now() && !['ended', 'failed'].includes(s.phase);
  const stop = (id, phase = 'ended', reason = phase === 'failed' ? 'failed' : 'stopped') => {
    const result = db
      .prepare(
        "UPDATE shows SET phase=?,end_reason=?,draft='',revision=revision+1 WHERE id=? AND phase NOT IN ('ended','failed')",
      )
      .run(phase, reason, id);
    if (result.changes) onChange(id);
    return result;
  };
  function current(id) {
    let row = read(id);
    if (!alive(row) && !['ended', 'failed'].includes(row.phase)) {
      stop(id, 'ended', 'time');
      row = read(id);
    }
    return row;
  }
  function start(
    actor,
    { requestId, prompt, image, resolution, aspectRatio = '16:9', memory = 12, seed = '', story = false },
  ) {
    if (
      !/^[a-z0-9-]{1,80}$/i.test(requestId ?? '') ||
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      prompt.length > 8000
    )
      fail(400, '需要开场和有效的请求编号');
    if (image) {
      let url;
      try {
        url = new URL(image);
      } catch {
        fail(400, '首图链接无效');
      }
      if (url.protocol !== 'https:' || url.username || url.password) fail(400, '首图需要 HTTPS');
    }
    const old = db
      .prepare('SELECT * FROM shows WHERE key_id=? AND request_id=?')
      .get(actor.keyId, requestId);
    let config;
    try {
      config = buildDirectorConfigure({
        prompt,
        imageUrl: image,
        resolution: resolution === undefined && old ? JSON.parse(old.config).resolution : resolution,
        aspectRatio,
        memory,
        seed,
      });
    } catch {
      fail(400, '开播参数无效');
    }
    const json = JSON.stringify(config);
    if (old) {
      if (old.config !== json) fail(409, '请求编号已用于另一组参数');
      return current(old.id);
    }
    if (
      db
        .prepare("SELECT 1 FROM shows WHERE key_id=? AND phase NOT IN ('ended','failed') AND expires>?")
        .get(actor.keyId, now())
    )
      fail(409, '已有直播会话，请先收播');
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    db.prepare(
      "INSERT INTO shows(id,owner,key_id,request_id,token,config,phase,expires,story) VALUES(?,?,?,?,?,?,'waiting',?,?)",
    ).run(id, actor.userId, actor.keyId, requestId, token, json, now() + maxMs, story === true ? 1 : 0);
    return read(id);
  }
  const present = (s) => ({
    id: s.id,
    phase: s.phase,
    version: s.version,
    appliedVersion: s.applied,
    frames: s.frames,
    recorded: Boolean(s.recording),
    ...(['ended', 'failed'].includes(s.phase) && s.end_reason ? { reason: s.end_reason } : {}),
    ...(s.phase === 'connected' ? { endsAt: s.expires } : {}),
  });
  function viewer(id, token) {
    const row = current(id);
    if (now() > row.expires + 300_000) fail(410, '播放票据已过期');
    if (typeof token !== 'string' || token.length !== 43 || digest(row.token) !== digest(token))
      fail(403, '播放凭据无效');
    return row;
  }
  function owned(id, actor) {
    const row = current(id);
    if (row.owner !== actor.userId || row.key_id !== actor.keyId) fail(404, '没有这场直播');
    return row;
  }
  function changes(s, after = 0) {
    return db
      .prepare('SELECT version,text,caption FROM directions WHERE show=? AND version>? ORDER BY version')
      .all(s.id, after)
      .map(({ version, text, caption }) => ({ version, text, ...(caption ? { caption } : {}) }));
  }
  // True while someone is still in the middle of a spoken direction.
  const drafting = (s) => Boolean(s.draft) && now() - (s.draft_at || 0) < DRAFT_HOLD_MS;
  // A direction the showrunner wrote, appended behind whatever the audience already sent.
  // A draft nobody finished within the hold is dropped, so it cannot hold the show forever.
  function append(s, { text, caption = '' }) {
    const latest = current(s.id);
    if (!alive(latest) || latest.phase !== 'connected' || drafting(latest)) return null;
    if (latest.draft) db.prepare("UPDATE shows SET draft='' WHERE id=? AND revision=?").run(s.id, latest.revision);
    const version = latest.version + 1;
    db.prepare("INSERT INTO directions(show,version,text,caption,source) VALUES(?,?,?,?,'showrunner')").run(
      s.id, version, text, caption || null);
    db.prepare('UPDATE shows SET version=? WHERE id=?').run(version, s.id);
    onChange(s.id);
    return version;
  }
  // ready: the host already wrote a finished direction, so it skips the organizer and goes straight out.
  async function input(s, { text, turnId, host = false, ready = false }, organize) {
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 6000 ||
      typeof turnId !== 'string' ||
      turnId.length > 100
    )
      fail(400, '导演输入无效');
    const prior = db.prepare('SELECT result FROM turns WHERE show=? AND id=?').get(s.id, turnId);
    if (prior) return prior.result ? JSON.parse(prior.result) : { action: 'pending' };
    s = current(s.id);
    if (!alive(s)) fail(409, '直播已结束');
    // A ready direction is complete on its own; it replaces any unfinished spoken draft.
    const draft = ready ? text.trim() : [s.draft, text.trim()].filter(Boolean).join(' ');
    if (draft.length > 8000) fail(400, '请缩短本次导演输入');
    db.prepare('INSERT INTO turns(show,id) VALUES(?,?)').run(s.id, turnId);
    db.prepare('UPDATE shows SET revision=revision+1,draft=?,draft_at=? WHERE id=?').run(draft, now(), s.id);
    const revision = read(s.id).revision;
    const previous = db
      .prepare('SELECT text FROM directions WHERE show=? ORDER BY version DESC LIMIT 3')
      .all(s.id)
      .reverse()
      .map((e) => e.text.slice(0, 2000));
    const started = now();
    let decision;
    try {
      decision = ready
        ? { action: 'send', text: draft }
        : await organize({ mode: host ? 'host' : 'director', text: draft, previous });
    } catch (error) {
      db.prepare('DELETE FROM turns WHERE show=? AND id=?').run(s.id, turnId);
      if (read(s.id).revision === revision)
        db.prepare('UPDATE shows SET draft=? WHERE id=?').run(s.draft, s.id);
      throw error;
    }
    if (!ready && ['send', 'chat', 'end'].includes(decision.action))
      await delay(Math.max(0, 650 - (now() - started)));
    const latest = current(s.id);
    let result = { action: 'superseded' };
    if (alive(latest) && latest.revision === revision) {
      result = { action: decision.action };
      if (decision.action === 'end') stop(s.id);
      if (decision.action === 'send') {
        const version = latest.version + 1;
        db.prepare('INSERT INTO directions(show,version,text) VALUES(?,?,?)').run(s.id, version, decision.text);
        db.prepare('UPDATE shows SET version=? WHERE id=?').run(version, s.id);
        result.version = version;
        onChange(s.id);
      }
      if (decision.action !== 'wait') db.prepare("UPDATE shows SET draft='' WHERE id=?").run(s.id);
    }
    db.prepare('UPDATE turns SET result=? WHERE show=? AND id=?').run(
      JSON.stringify(result),
      s.id,
      turnId,
    );
    return result;
  }
  function takeOffer(s) {
    if (
      !alive(s) ||
      !db
        .prepare("UPDATE shows SET phase='connecting', offers=offers+1, expires=? WHERE id=? AND phase='waiting'")
        .run(now() + maxMs, s.id).changes
    )
      fail(409, '本场已经提交过连接');
  }
  // A transient provider failure on the first offer may be retried once by the same player.
  function reopen(s) {
    return db.prepare("UPDATE shows SET phase='waiting' WHERE id=? AND phase='connecting' AND provider_session IS NULL AND offers<2").run(s.id).changes > 0;
  }
  function connected(id, session) {
    if (read(id).phase !== 'connecting') fail(409, '本场已关闭');
    db.prepare("UPDATE shows SET provider_session=?,phase='connected' WHERE id=?").run(session, id);
  }
  function receipt(s, { applied = 0, frames = 0 }) {
    if (
      !Number.isSafeInteger(applied) ||
      applied < 0 ||
      applied > s.version ||
      !Number.isSafeInteger(frames) ||
      frames < 0
    )
      fail(400, '无效回执');
    db.prepare('UPDATE shows SET applied=max(applied,?),frames=max(frames,?) WHERE id=?').run(
      applied,
      frames,
      s.id,
    );
  }
  function recording(s, format) {
    db.prepare('UPDATE shows SET recording=? WHERE id=?').run(format, s.id);
  }
  function activity(s) {
    db.prepare("UPDATE shows SET revision=revision+1,draft_at=? WHERE id=? AND draft!=''").run(now(), s.id);
  }
  return {
    activity,
    append,
    drafting,
    start,
    current,
    alive,
    stop,
    present,
    owned,
    viewer,
    changes,
    input,
    takeOffer,
    reopen,
    connected,
    receipt,
    recording,
    close: () => db.close(),
  };
}
