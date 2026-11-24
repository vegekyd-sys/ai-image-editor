import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessions } from '../../services/director/sessions.mjs';

test('one key owns one session, repeated start is safe, player and owner grants are distinct', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'director-'));
  let clock = 100;
  const service = createSessions(dir, { now: () => clock });
  t.after(() => {
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const owner = { keyId: 'a', userId: 'owner' },
    input = { requestId: 'same', prompt: '开场' };
  const s = service.start(owner, input);
  assert.equal(JSON.parse(s.config).resolution, '480p');
  assert.equal(service.start(owner, input).id, s.id);
  assert.throws(() => service.start(owner, { ...input, requestId: 'another' }), { status: 409 });
  assert.throws(() => service.owned(s.id, { ...owner, keyId: 'b' }), { status: 404 });
  assert.throws(() => service.viewer(s.id, 'invalid'), { status: 403 });
  assert.equal(service.viewer(s.id, s.token).id, s.id);
  service.takeOffer(s);
  assert.throws(() => service.takeOffer(s), { status: 409 });
  service.connected(s.id, 'provider');
  clock += 121000;
  assert.equal(service.current(s.id).phase, 'ended');
  const hd = { ...input, requestId: 'hd' };
  const old = service.start(owner, { ...hd, resolution: '768p' });
  assert.equal(JSON.parse(old.config).resolution, '768p');
  // Retries from a previous version keep the resolution of the original request.
  assert.equal(service.start(owner, hd).id, old.id);
  assert.throws(() => service.start(owner, { ...hd, resolution: '480p' }), { status: 409 });
});
test('superseded, duplicate and ordinary turns cannot enqueue extra directions', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'director-')),
    api = createSessions(dir);
  t.after(() => {
    api.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const s = api.start({ keyId: 'a', userId: 'b' }, { requestId: 'r', prompt: '白兔' });
  let complete;
  const pending = api.input(s, { text: '下雨', turnId: '1' }, () => new Promise((r) => (complete = r)));
  const correction = api.input(s, { text: '改成下雪', turnId: '2' }, async () => ({
    action: 'send',
    text: '下雪',
  }));
  complete({ action: 'send', text: '下雨' });
  assert.equal((await pending).action, 'superseded');
  assert.equal((await correction).version, 2);
  assert.equal((await api.input(s, { text: '改成下雪', turnId: '2' }, () => assert.fail())).version, 2);
  await api.input(s, { text: '这是哪里？', turnId: '3', host: true }, async () => ({ action: 'chat' }));
  assert.deepEqual(
    api.changes(s).map((c) => c.text),
    ['下雪'],
  );
  assert.equal(
    (await api.input(s, { text: '收播了', turnId: '4', host: true }, async () => ({ action: 'end' })))
      .action,
    'end',
  );
  assert.equal(api.current(s.id).phase, 'ended');
});

test('a semantic host end decision closes a pending draft and returns its receipt on retry', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'director-'));
  const api = createSessions(dir);
  t.after(() => { api.close(); rmSync(dir, { recursive: true, force: true }); });
  const show = api.start({ keyId: 'a', userId: 'b' }, { requestId: 'r', prompt: '开场' });
  for (const text of ['先别结束直播', '结束直播了吗？', '等一下再结束直播', '他说“结束直播”']) {
    const result = await api.input(show, { text, turnId: text, host: true }, async () => ({ action: 'wait' }));
    assert.equal(result.action, 'wait');
  }
  const turn = { text: '今天就播到这儿。', turnId: 'end', host: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await api.input(show, turn, () => attempt === 0 ? {action:'end'} : assert.fail()), { action: 'end' });
    assert.equal(api.current(show.id).phase, 'ended');
  }
});
