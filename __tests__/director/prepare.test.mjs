import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDirectorServer} from '../../services/director/server.mjs';

test('preparing a show overlaps image staging and ICE; the player needs its own ticket and active key', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'director-ice-'));
  const requests = [];
  const servers = [{urls:'stun:example.test'}];
  let active = true, finishStaging, stages = 0;
  const image = 'https://cdn.makaron.app/storage/v1/object/public/images/test.jpg';
  const server = createDirectorServer({
    directory, authenticate: () => ({userId:'u',keyId:'k'}), activeKey: () => active,
    stageImage(source) {
      assert.equal(source, image);
      stages++;
      return new Promise(resolve => { finishStaging = resolve; });
    },
    providerKey:'test', fetcher: async url => {
      requests.push(url);
      return Response.json({ice_servers:servers});
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive:true,force:true});
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, data, headers={}) => fetch(base+route,{method:'POST',headers,body:JSON.stringify(data)});
  const start = () => post('/api/director',{action:'start',requestId:'test',image,prompt:'热巧克力'});
  const show = await (await start()).json();
  await start();
  const ticket = show.playerPath.split('.').at(-1);
  const poll = (token, data) => post('/api/director/player/poll?id='+show.id,data,{'x-director-player':token});
  assert.deepEqual(requests,['https://wma.fal.run/ice']);
  assert.equal((await poll('wrong',{prepare:true})).status,403);
  assert.deepEqual((await (await poll(ticket,{prepare:true})).json()).iceServers, servers);
  assert.equal((await (await poll(ticket,{})).json()).iceServers, undefined);
  const initial = await (await poll(ticket,{})).json();
  assert.equal(initial.config.resolution,'480p');
  assert.equal(initial.config.image_url,image);
  assert.equal(initial.preparedImageUrl,undefined);
  assert.equal(stages,1);
  finishStaging('https://fal.example/prepared.jpg');
  const next = await (await poll(ticket,{})).json();
  assert.equal(next.preparedImageUrl,'https://fal.example/prepared.jpg');
  assert.equal(next.config.image_url,image);
  assert.equal((await poll('wrong',{})).status,403);
  active = false;
  assert.equal((await poll(ticket,{prepare:true})).status,403);
});
