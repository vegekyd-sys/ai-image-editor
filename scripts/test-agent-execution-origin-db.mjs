// Disposable PostgreSQL only. No network, credentials or real customer rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
let checks = 0;
const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const local = 'http://localhost:3000';
const prod = 'https://www.makaron.app';
const preview = 'https://preview-a.vercel.app';
async function reset(origin, extra = {}) {
  await db.exec('DELETE FROM agent_runs');
  await db.query(`INSERT INTO agent_runs(id,user_id,project_id,status,prompt,objective,metadata,next_attempt_at,lease_expires_at,attempt_count)
    VALUES($1,$2,$3,$4,'hat edit','hat edit',$5::jsonb,$6,$7,1)`,
    [id, owner, project, extra.status || 'running', JSON.stringify({ ...(extra.unpinned ? {} : {executionOwnerOrigin: origin ?? ''}), executionRequest: { origin, videoModel:'fal-h3-max', videoResolution:'768p', videoAuto:true } }), extra.next || null, extra.lease || null]);
}
async function claim(origin, legacy = false) {
  const result = legacy
    ? await db.query('SELECT * FROM claim_agent_execution($1,$2,480)',[id,'old-production-worker'])
    : await db.query('SELECT * FROM claim_agent_execution_for_origin($1,$2,$3,480)',[id,'scoped-worker',origin]);
  return result.rows;
}
async function unchangedReject(origin, legacy = false) {
  const before = (await db.query('SELECT * FROM agent_runs')).rows;
  assert.equal((await claim(origin,legacy)).length,0);
  assert.deepEqual((await db.query('SELECT * FROM agent_runs')).rows,before);
  checks++;
}
try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE agent_runs (id uuid PRIMARY KEY, user_id uuid, project_id uuid, status text, prompt text, objective text,
      acceptance_criteria jsonb, execution_policy jsonb, metadata jsonb, lease_token uuid, lease_owner text,
      lease_expires_at timestamptz, next_attempt_at timestamptz, attempt_count integer);
    GRANT USAGE ON SCHEMA public TO authenticated, service_role;
    GRANT ALL ON agent_runs TO authenticated, service_role;
    ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_only ON agent_runs TO authenticated USING(user_id='${owner}'::uuid) WITH CHECK(user_id='${owner}'::uuid);`);
  const old = readFileSync('supabase/migrations/20260712000000_durable_agent_executions.sql','utf8');
  await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION claim_agent_execution('), old.indexOf('CREATE OR REPLACE FUNCTION claim_agent_operation(')));
  await reset(local);
  assert.equal((await claim(null,true)).length,1); // reproduce cross-environment theft
  checks++;
  const migration = readFileSync('supabase/migrations/20260905190237_isolate_agent_execution_origins.sql','utf8');
  await db.exec(migration);
  await db.exec(migration); // repeatable migration
  for (const origin of [local,preview,'http://localhost:4395','https://preview-b.vercel.app']) {
    await reset(origin);
    await unchangedReject(null,true);
    await unchangedReject(prod);
    const [accepted] = await claim(origin);
    assert.equal(accepted.attempt_no,2);
    assert.equal(accepted.metadata.executionRequest.videoModel,'fal-h3-max');
    assert.equal(accepted.metadata.executionRequest.videoResolution,'768p');
    checks++;
    await unchangedReject(origin); // only one claimant may own the lease
  }
  await reset(local, {unpinned:true});
  assert.equal((await claim(null,true)).length,1); checks++; // old running jobs are untouched
  await reset(local); await unchangedReject(preview);
  await reset(preview); await unchangedReject('https://preview-b.vercel.app');
  for (const origin of [undefined,'',prod,'https://makaron.app']) {
    await reset(origin); assert.equal((await claim(null,true)).length,1); checks++;
    await reset(origin); assert.equal((await claim(prod)).length,1); checks++;
    await reset(origin); await unchangedReject(local);
  }
  for (const state of [{status:'completed'},{lease:'2099-01-01T00:00:00Z'},{next:'2099-01-01T00:00:00Z'}]) {
    await reset(local,state); await unchangedReject(local);
  }
  await reset(local,{lease:'2000-01-01T00:00:00Z'});
  assert.equal((await claim(local)).length,1); checks++;
  // Actual invoker/RLS behavior: matching origin cannot bypass tenant ownership.
  await reset(local);
  await db.exec('SET ROLE authenticated');
  assert.equal((await claim(local)).length,1); checks++;
  await db.exec('RESET ROLE'); await reset(local);
  await db.query('UPDATE agent_runs SET user_id=$1',['44444444-4444-4444-8444-444444444444']);
  await db.exec('SET ROLE authenticated');
  assert.equal((await claim(local)).length,0); checks++;
  await db.exec('RESET ROLE');
  console.log(JSON.stringify({passed:checks,reproducedOldBug:true,localResumeModel:'fal-h3-max',isolation:'PGlite synthetic rows; no network'}));
} finally { await db.close(); }
