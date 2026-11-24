import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShowrunner, parsePlan, planStory } from '../../src/lib/director/showrunner.mjs';
import { createSessions } from '../../services/director/sessions.mjs';

const pace = { opening: 8000, auto: 7000, user: 12000, unplayed: 20000 };
const beats = (n, tag = 'b') =>
  Array.from({ length: n }, (_, i) => ({ prompt: `${tag}${i} 老板把礼盒递给小猫，镜头推近`, caption: `${tag}${i}` }));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a plan is parsed into short captions and bounded beats', () => {
  const content = JSON.stringify({
    arc: { title: '礼盒', objective: '送出礼盒', payoff: '小猫打开礼盒' },
    beats: [
      { prompt: '银发老板弯腰把系红丝带的礼盒放到柜台上，中景', caption: '老板拿出礼盒，小猫凑过来闻了又闻然后跳上了柜台还打了滚' },
      { prompt: '短', caption: '太短的指令被丢掉' },
      { prompt: '小猫用爪子拨开丝带，近景特写', caption: '' },
    ],
  });
  const plan = parsePlan({ choices: [{ finish_reason: 'stop', message: { content } }] });
  assert.equal(plan.beats.length, 1);
  assert.equal(plan.beats[0].caption, '老板拿出礼盒，小猫凑过来闻了又闻然后跳上了柜台还');
  assert.equal(plan.arc.payoff, '小猫打开礼盒');
  assert.throws(() => parsePlan({ choices: [{ finish_reason: 'length', message: { content } }] }), /incomplete/);
});

test('planning asks DeepSeek flash by default and needs a key', async () => {
  await assert.rejects(planStory({}, { env: {} }), /missing_credentials/);
  let asked;
  const content = JSON.stringify({ beats: beats(2) });
  const plan = await planStory({ premise: '巧克力店' }, {
    env: { DEEPSEEK_API_KEY: 'test' },
    fetchImpl: async (_url, init) => {
      asked = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
    },
  });
  assert.equal(asked.model, 'deepseek-v4-flash');
  assert.equal(plan.beats.length, 2);
});

test('beats wait for the opening to hold on screen, then follow one another', async () => {
  let clock = 0;
  const asked = [];
  const runner = createShowrunner({
    now: () => clock,
    pace,
    report: () => {},
    plan: async (input) => {
      asked.push(input);
      return { arc: { title: 't' }, beats: beats(4) };
    },
  });
  runner.open('s', { premise: '巧克力店老板', hasImage: true });
  assert.equal(asked.length, 1, 'the first plan starts with the show, not with the first frame');
  assert.equal(asked[0].openingImage, true);
  await settle();
  assert.equal(runner.next('s', 1), null, 'nothing goes out before the opening is on screen');
  clock = 5000;
  runner.observe('s', 1);
  clock = 12000;
  assert.equal(runner.next('s', 1), null);
  clock = 13000;
  const first = runner.next('s', 1);
  assert.ok(first);
  runner.sent('s', 2, first);
  assert.equal(runner.next('s', 2), null, 'the beat just sent has to play first');
  clock = 17000;
  runner.observe('s', 2);
  clock = 24000;
  const second = runner.next('s', 2);
  assert.notEqual(second, first);
  assert.equal(runner.next('s', 2, { busy: true }), null, 'an unsent spoken draft holds the show');
});

test('an audience direction drops the old route and replans around it', async () => {
  let clock = 0;
  const asked = [];
  let finishOld;
  const runner = createShowrunner({
    now: () => clock,
    pace,
    report: () => {},
    plan: (input, { signal }) => {
      asked.push(input);
      if (asked.length === 1)
        return new Promise((resolve, reject) => {
          finishOld = () => resolve({ beats: beats(4, 'old') });
          signal.addEventListener('abort', () => reject(Error('aborted')));
        });
      return Promise.resolve({ beats: beats(3, 'new') });
    },
  });
  runner.open('s', { premise: '巧克力店' });
  runner.user('s', { version: 2, text: '一只小橘猫跳上柜台' });
  finishOld?.();
  await settle();
  assert.equal(asked[1].mode, 'directive');
  assert.equal(asked[1].directive, '一只小橘猫跳上柜台');
  assert.equal(runner.next('s', 1), null, 'a stale version never releases a beat');
  clock = 1000;
  runner.observe('s', 2);
  clock = 12000;
  assert.equal(runner.next('s', 2), null, 'the audience direction holds longer than an automatic one');
  clock = 13001;
  assert.match(runner.next('s', 2).prompt, /^new0/);
});

test('a direction that never reports playing still lets the story continue', async () => {
  let clock = 0;
  const runner = createShowrunner({ now: () => clock, pace, report: () => {}, plan: async () => ({ beats: beats(2) }) });
  runner.open('s', { premise: '巧克力店' });
  await settle();
  clock = 19999;
  assert.equal(runner.next('s', 1), null);
  clock = 20000;
  assert.ok(runner.next('s', 1));
});

test('planning failures back off and stop after three tries', async () => {
  let clock = 0, calls = 0;
  const runner = createShowrunner({
    now: () => clock, pace, report: () => {},
    plan: async () => { calls++; throw Error('plan_http_500'); },
  });
  runner.open('s', { premise: '巧克力店' });
  await settle();
  runner.next('s', 1);
  assert.equal(calls, 1, 'no retry inside the back-off');
  for (let i = 0; i < 5; i++) {
    clock += 6000;
    runner.next('s', 1);
    await settle();
  }
  assert.equal(calls, 3);
});

test('showrunner directions are appended only while live and carry their caption', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'director-'));
  const changed = [];
  const api = createSessions(dir, { onChange: (id) => changed.push(id) });
  t.after(() => {
    api.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const s = api.start({ keyId: 'a', userId: 'b' }, { requestId: 'r', prompt: '巧克力店', story: true });
  assert.equal(s.story, 1);
  assert.equal(api.append(s, { text: '小猫跳上柜台', caption: '小猫来了' }), null, 'not before the picture is live');
  api.takeOffer(s);
  api.connected(s.id, 'provider');
  assert.equal(api.append(s, { text: '小猫跳上柜台', caption: '小猫来了' }), 2);
  const ready = await api.input(s, { text: '老板递出礼盒', turnId: 't', ready: true }, () => assert.fail('no organizer'));
  assert.equal(ready.version, 3);
  assert.deepEqual(api.changes(s, 1), [
    { version: 2, text: '小猫跳上柜台', caption: '小猫来了' },
    { version: 3, text: '老板递出礼盒' },
  ]);
  assert.equal(changed.length, 2);
  api.stop(s.id);
  assert.equal(changed.length, 3, 'stopping wakes a waiting player');
});
