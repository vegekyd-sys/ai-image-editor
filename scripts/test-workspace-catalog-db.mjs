// Isolated PostgreSQL/WASM test: no remote database, credentials or customer data.
// PGLITE_MODULE=/.../@electric-sql/pglite/dist/index.js node scripts/test-workspace-catalog-db.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to an installed PGlite module.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const own = '00000000-0000-4000-8000-000000000011', other = '00000000-0000-4000-8000-000000000012', shared = '00000000-0000-4000-8000-000000000013';
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid,is_public boolean);
CREATE INDEX ON projects(user_id,id);
CREATE TABLE snapshots(id uuid PRIMARY KEY,project_id uuid REFERENCES projects,sort_order int,image_url text);
CREATE INDEX ON snapshots(project_id,sort_order);
CREATE TABLE messages(id text PRIMARY KEY,project_id uuid REFERENCES projects,content text);
CREATE TABLE agent_runs(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE agent_events(id uuid PRIMARY KEY,project_id uuid REFERENCES projects,run_id uuid REFERENCES agent_runs);
CREATE TABLE workspace_files(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid,path text,content_type text,size_bytes bigint,storage_url text,updated_at timestamptz DEFAULT now());
CREATE INDEX ON workspace_files(user_id,path); CREATE INDEX ON workspace_files(path text_pattern_ops);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY; ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY; ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY; ALTER TABLE workspace_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own projects" ON projects FOR ALL USING(auth.uid()=user_id);
CREATE POLICY "Public projects" ON projects FOR SELECT USING(is_public);
CREATE POLICY "Users own snapshots" ON snapshots FOR ALL USING(project_id IN(SELECT id FROM projects WHERE user_id=auth.uid()));
CREATE POLICY "Public snapshots" ON snapshots FOR SELECT USING(project_id IN(SELECT id FROM projects WHERE is_public));
CREATE POLICY "Users own messages" ON messages FOR ALL USING(project_id IN(SELECT id FROM projects WHERE user_id=auth.uid()));
CREATE POLICY "Public messages" ON messages FOR SELECT USING(project_id IN(SELECT id FROM projects WHERE is_public));
CREATE POLICY "Users own runs" ON agent_runs FOR ALL USING(user_id=auth.uid());
CREATE POLICY "Users own events" ON agent_events FOR ALL USING(run_id IN(SELECT id FROM agent_runs WHERE user_id=auth.uid()));
CREATE POLICY "Users read project events" ON agent_events FOR SELECT USING(project_id IN(SELECT id FROM projects WHERE user_id=auth.uid()));
CREATE POLICY "Public events" ON agent_events FOR SELECT USING(project_id IN(SELECT id FROM projects WHERE is_public));
CREATE POLICY "Users see own and global files" ON workspace_files FOR SELECT USING(user_id=auth.uid() OR user_id IS NULL);
CREATE POLICY "Users insert files" ON workspace_files FOR INSERT WITH CHECK(user_id=auth.uid());
CREATE POLICY "Users update files" ON workspace_files FOR UPDATE USING(user_id=auth.uid());
CREATE POLICY "Users delete files" ON workspace_files FOR DELETE USING(user_id=auth.uid());
CREATE POLICY "Service full access" ON workspace_files FOR ALL USING(auth.role()='service_role');
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated,service_role;
INSERT INTO projects VALUES('${own}','${a}',false),('${other}','${b}',false),('${shared}','${b}',true);
INSERT INTO snapshots SELECT id,id,0,'https://example.com/image' FROM projects;
INSERT INTO messages SELECT id::text,id,'same text' FROM projects;
INSERT INTO agent_runs VALUES('${own}','${a}'),('${other}','${b}');
INSERT INTO agent_events SELECT id,id,id FROM projects WHERE id<>'${shared}';
INSERT INTO workspace_files(user_id,path,content_type,size_bytes,storage_url) VALUES
('${a}','skills/own/SKILL.md','text/markdown',10,'https://example.com/own'),
('${a}','skills/own/.makaron-skill-index.json','application/json',20,'https://example.com/index'),
('${b}','skills/other/SKILL.md','text/markdown',10,'https://example.com/other'),
(NULL,'skills/global/SKILL.md','text/markdown',10,'https://example.com/global'),
(NULL,'skills/global/.makaron-skill-index.json','application/json',20,'https://example.com/global-index'),
('${a}','unrelated/SKILL.md','text/markdown',10,'https://example.com/unrelated');
INSERT INTO workspace_files(user_id,path,content_type,size_bytes,storage_url)
SELECT '${a}','skills/own/assets/'||g||'.png','image/png',20,'https://example.com/asset' FROM generate_series(1,50000) g;
ANALYZE workspace_files;
`);
async function as(role, user, work) {
  await db.exec(`SET ROLE ${role};SELECT set_config('request.jwt.claim.sub','${user ?? ''}',false);SELECT set_config('request.jwt.claim.role','${role}',false);`);
  try { return await work(); } finally { await db.exec('RESET ROLE'); }
}
async function visible() {
  const result = {};
  for (const [role,user] of [['anon',null],['authenticated',a],['authenticated',b],['service_role',null]]) {
    result[role+(user??'')] = await as(role,user,async()=>{
      const r={};for(const table of ['projects','snapshots','messages','agent_runs','agent_events'])r[table]=(await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows;
      r.files=(await db.query("SELECT path,user_id FROM workspace_files WHERE path LIKE '%SKILL.md' ORDER BY path")).rows;return r;
    });
  } return result;
}
const baseline=await visible();
const query=`SELECT path,content_type,size_bytes,storage_url,updated_at FROM workspace_files WHERE (user_id='${a}' OR user_id IS NULL) AND path LIKE 'skills/%/SKILL.md' ORDER BY path`;
const before=await as('authenticated',a,()=>db.query(query));
const beforePlan=await as('authenticated',a,()=>db.query('EXPLAIN(ANALYZE,FORMAT JSON) '+query));
const aclBefore=(await db.query("SELECT relname,relacl::text FROM pg_class WHERE relname IN ('projects','snapshots','messages','agent_runs','agent_events','workspace_files') ORDER BY relname")).rows;
const files=readdirSync('supabase/migrations');
for(const suffix of ['workspace_skill_catalog_index.sql','workspace_catalog_rpc_and_rls_initplans.sql']){
  const file=files.find(x=>x.endsWith(suffix));assert.ok(file);await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace('INDEX CONCURRENTLY','INDEX'));
}
assert.deepEqual(await visible(),baseline);
assert.deepEqual((await db.query("SELECT relname,relacl::text FROM pg_class WHERE relname IN ('projects','snapshots','messages','agent_runs','agent_events','workspace_files') ORDER BY relname")).rows,aclBefore);
const after=await as('authenticated',a,()=>db.query('SELECT * FROM list_workspace_skill_entries($1,false)',[a]));
assert.deepEqual(after.rows,before.rows);
const manifests=await as('authenticated',a,()=>db.query('SELECT path FROM list_workspace_skill_entries($1,true)',[a]));
assert.deepEqual(manifests.rows.map(x=>x.path),['skills/global/.makaron-skill-index.json','skills/own/.makaron-skill-index.json']);
const forged=await as('authenticated',a,()=>db.query('SELECT path FROM list_workspace_skill_entries($1,false)',[b]));
assert.deepEqual(forged.rows.map(x=>x.path),['skills/global/SKILL.md']);
await as('anon',null,()=>assert.rejects(db.query('SELECT * FROM list_workspace_skill_entries($1,false)',[a]),/permission denied/));
await as('authenticated',a,async()=>{
  await db.exec("SET plan_cache_mode='force_generic_plan'");
  await db.exec('PREPARE skill_catalog(uuid,boolean) AS SELECT * FROM list_workspace_skill_entries($1,$2)');
  for(let i=0;i<6;i++)assert.deepEqual((await db.query(`EXECUTE skill_catalog('${a}',false)`)).rows,before.rows);
  await db.exec('DEALLOCATE skill_catalog;RESET plan_cache_mode');
  await db.query("INSERT INTO messages(id,project_id,content) VALUES('allowed',$1,'same result')",[own]);
  await assert.rejects(db.query("INSERT INTO messages(id,project_id,content) VALUES('denied',$1,'no')",[other]),/row-level security/);
  await assert.rejects(db.query("INSERT INTO messages(id,project_id,content) VALUES('public-denied',$1,'no')",[shared]),/row-level security/);
  await assert.rejects(db.query("UPDATE messages SET project_id=$1 WHERE id='allowed'",[other]),/row-level security/);
  await assert.rejects(db.query("INSERT INTO workspace_files(user_id,path) VALUES($1,'forged')",[b]),/row-level security/);
  await assert.rejects(db.query("UPDATE workspace_files SET user_id=$1 WHERE path='skills/own/SKILL.md'",[b]),/row-level security/);
});
const afterPlan=await as('authenticated',a,()=>db.query('EXPLAIN(ANALYZE,FORMAT JSON) '+query));
assert.match(JSON.stringify(afterPlan.rows),/idx_workspace_skill_catalog/);
const fn=(await db.query("SELECT prosecdef FROM pg_proc WHERE proname='list_workspace_skill_entries'")).rows;assert.equal(fn[0].prosecdef,false);
console.log(JSON.stringify({passed:true,checks:['same contents/order/fields','own/global scope','forged owner denied','anon denied','service bypass unchanged','all existing visibility unchanged','table grants unchanged','generic prepared plans','owner insert allowed','stranger/public insert denied','ownership reassignment denied','partial index selected'],beforeMs:beforePlan.rows[0]['QUERY PLAN'][0]['Execution Time'],afterMs:afterPlan.rows[0]['QUERY PLAN'][0]['Execution Time']}));
await db.close();
