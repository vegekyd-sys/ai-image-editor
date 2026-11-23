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

export function createSessions(directory, { now = Date.now } = {}) {
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
  const read = (id) => db.prepare('SELECT * FROM shows WHERE id=?').get(id) ?? fail(404, '没有这场直播');
  const alive = (s) => s.expires > now() && !['ended', 'failed'].includes(s.phase);
  const stop = (id, phase = 'ended') =>
    db
      .prepare(
        "UPDATE shows SET phase=?,draft='',revision=revision+1 WHERE id=? AND phase NOT IN ('ended','failed')",
      )
      .run(phase, id);
  function current(id) {
    let row = read(id);
    if (!alive(row) && !['ended', 'failed'].includes(row.phase)) {
      stop(id);
      row = read(id);
    }
    return row;
  }
  function start(
    actor,
    { requestId, prompt, image, resolution = '768p', aspectRatio = '16:9', memory = 12, seed = '' },
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
    let config;
    try {
      config = buildDirectorConfigure({
        prompt,
        imageUrl: image,
        resolution,
        aspectRatio,
        memory,
        seed,
      });
    } catch {
      fail(400, '开播参数无效');
    }
    const json = JSON.stringify(config);
    const old = db
      .prepare('SELECT * FROM shows WHERE key_id=? AND request_id=?')
      .get(actor.keyId, requestId);
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
      "INSERT INTO shows(id,owner,key_id,request_id,token,config,phase,expires) VALUES(?,?,?,?,?,?,'waiting',?)",
    ).run(id, actor.userId, actor.keyId, requestId, token, json, now() + MAX_MS);
    return read(id);
  }
  const present = (s) => ({
    id: s.id,
    phase: s.phase,
    version: s.version,
    appliedVersion: s.applied,
    frames: s.frames,
    recorded: Boolean(s.recording),
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
      .prepare('SELECT version,text FROM directions WHERE show=? AND version>? ORDER BY version')
      .all(s.id, after);
  }
  async function input(s, { text, turnId, host = false }, organize) {
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
    const draft = [s.draft, text.trim()].filter(Boolean).join(' ');
    if (draft.length > 8000) fail(400, '请缩短本次导演输入');
    db.prepare('INSERT INTO turns(show,id) VALUES(?,?)').run(s.id, turnId);
    db.prepare('UPDATE shows SET revision=revision+1,draft=? WHERE id=?').run(draft, s.id);
    const revision = read(s.id).revision;
    const previous = db
      .prepare('SELECT text FROM directions WHERE show=? ORDER BY version DESC LIMIT 3')
      .all(s.id)
      .reverse()
      .map((e) => e.text.slice(0, 2000));
    const started = now();
    let decision;
    try {
      decision = await organize({ mode: host ? 'host' : 'director', text: draft, previous });
    } catch (error) {
      db.prepare('DELETE FROM turns WHERE show=? AND id=?').run(s.id, turnId);
      if (read(s.id).revision === revision)
        db.prepare('UPDATE shows SET draft=? WHERE id=?').run(s.draft, s.id);
      throw error;
    }
    if (['send', 'chat', 'end'].includes(decision.action))
      await delay(Math.max(0, 650 - (now() - started)));
    const latest = current(s.id);
    let result = { action: 'superseded' };
    if (alive(latest) && latest.revision === revision) {
      result = { action: decision.action };
      if (decision.action === 'end') stop(s.id);
      if (decision.action === 'send') {
        const version = latest.version + 1;
        db.prepare('INSERT INTO directions VALUES(?,?,?)').run(s.id, version, decision.text);
        db.prepare('UPDATE shows SET version=? WHERE id=?').run(version, s.id);
        result.version = version;
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
        .prepare("UPDATE shows SET phase='connecting', expires=? WHERE id=? AND phase='waiting'")
        .run(now() + MAX_MS, s.id).changes
    )
      fail(409, '本场已经提交过连接');
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
    db.prepare("UPDATE shows SET revision=revision+1 WHERE id=? AND draft!=''").run(s.id);
  }
  return {
    activity,
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
    connected,
    receipt,
    recording,
    close: () => db.close(),
  };
}
