import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDirectorServer} from '../../services/director/server.mjs';
import {createShowrunner} from '../../src/lib/director/showrunner.mjs';

test('a ready direction reaches a waiting player at once and the showrunner fills the quiet after it', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'director-story-'));
  let clock = 0;
  const plans = [];
  const showrunner = createShowrunner({
    now: () => clock, report: () => {},
    pace: {opening: 8000, auto: 7000, user: 12000, unplayed: 20000},
    plan: async input => {
      plans.push(input.mode);
      return {beats: [{prompt: input.mode + ' 老板把礼盒推到小猫面前，近景', caption: input.mode === 'directive' ? '小猫拆礼盒' : '老板招手'}]};
    },
  });
  const server = createDirectorServer({
    directory, showrunner, authenticate: () => ({userId: 'u', keyId: 'k'}), activeKey: () => true,
    providerKey: 'test', organize: () => assert.fail('a ready direction skips the organizer'),
    fetcher: async url => Response.json(url.endsWith('/ice') ? {ice_servers: []} : {session_id: 'provider'}),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, data, headers = {}) => fetch(base + route, {method: 'POST', headers, body: JSON.stringify(data)}).then(r => r.json());
  const show = await post('/api/director', {action: 'start', requestId: 'story', prompt: '巧克力店', story: true});
  assert.deepEqual(plans, [], 'nothing is planned while the opening negotiates');
  const ticket = show.playerPath.split('.').at(-1);
  const player = (op, data, headers = {}) => post('/api/director/player/' + op + '?id=' + show.id, data, {'x-director-player': ticket, ...headers});
  await player('poll', {prepare: true});
  await player('signal', {app_id: 'minimax/h3-max/director', type: 'offer', sdp: 'v=0'}, {'x-fal-target-url': 'https://wma.fal.run/session'});
  assert.deepEqual(plans, ['continue'], 'the first plan starts once the provider answered');

  // The opening is on screen; a direction posted during a held poll answers it immediately.
  await player('poll', {after: 1, playing: 1});
  const waited = performance.now();
  const held = player('poll', {after: 1, playing: 1, wait: 2000});
  await new Promise(resolve => setTimeout(resolve, 100));
  const sent = await post('/api/director', {action: 'direct', id: show.id, text: '一只小橘猫跳上柜台', turnId: 't1', ready: true});
  assert.equal(sent.version, 2);
  const answer = await held;
  assert.ok(performance.now() - waited < 1000, 'the held poll returns as soon as the direction exists');
  assert.deepEqual(answer.directions, [{version: 2, text: '一只小橘猫跳上柜台'}]);
  assert.deepEqual(plans, ['continue', 'directive']);

  // The audience direction plays for its hold, then the replanned beat follows with a caption.
  clock = 1000;
  await player('poll', {after: 2, playing: 2});
  clock = 12000;
  assert.deepEqual((await player('poll', {after: 2, playing: 2})).directions, []);
  clock = 13001;
  const next = await player('poll', {after: 2, playing: 2});
  assert.equal(next.directions[0].version, 3);
  assert.equal(next.directions[0].caption, '小猫拆礼盒');
  assert.match(next.directions[0].text, /^directive/);
});
