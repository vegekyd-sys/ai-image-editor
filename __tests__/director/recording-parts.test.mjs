import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDirectorServer} from '../../services/director/server.mjs';

test('a recording arrives in parts: repeats are acknowledged, gaps refused, the last part closes it', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'director-parts-'));
  const server = createDirectorServer({
    directory, authenticate: () => ({userId: 'u', keyId: 'k'}), activeKey: () => true, providerKey: 'test',
    organize: async () => ({action: 'wait'}),
    fetcher: async url => Response.json(url.endsWith('/ice') ? {ice_servers: []} : {session_id: 'provider'}),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const show = await (await fetch(base + '/api/director', {method: 'POST', body: JSON.stringify({action: 'start', requestId: 'parts', prompt: '巧克力店'})})).json();
  const ticket = show.playerPath.split('.').at(-1);
  const player = (op, body, headers = {}) => fetch(base + '/api/director/player/' + op + '?id=' + show.id, {method: 'POST', headers: {'x-director-player': ticket, ...headers}, body});
  await player('poll', JSON.stringify({prepare: true}), {'content-type': 'application/json'});
  await player('signal', JSON.stringify({app_id: 'minimax/h3-max/director', type: 'offer', sdp: 'v=0'}), {'content-type': 'application/json', 'x-fal-target-url': 'https://wma.fal.run/session'});

  const part = (offset, text, total) => player('recording', text, {'content-type': 'video/mp4', 'x-recording-offset': String(offset), ...(total === undefined ? {} : {'x-recording-final': String(total)})});
  assert.deepEqual(await (await part(0, 'abc')).json(), {size: 3});
  assert.deepEqual(await (await part(0, 'abc')).json(), {size: 3}, 'a repeated part is acknowledged, not appended');
  const gap = await part(9, 'zzz');
  assert.equal(gap.status, 409);
  assert.equal((await gap.json()).size, 3);
  assert.deepEqual(await (await part(3, 'de', 5)).json(), {saved: true, size: 5});
  assert.equal((await (await player('recording', 'x', {'content-type': 'video/mp4'})).json()).saved, true, 'a saved recording is not replaced');

  const exported = await fetch(base + '/api/director', {method: 'POST', body: JSON.stringify({action: 'export', id: show.id})});
  assert.equal(await exported.text(), 'abcde');
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(show.id)), [show.id + '.mp4']);
});
