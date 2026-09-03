// Isolated PostgreSQL/WASM test. No environment files, remote DB or user data.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-media-pricing-db.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to an installed PGlite module path.')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const db = new PGlite()
const user = '00000000-0000-4000-8000-000000000001'
const stranger = '00000000-0000-4000-8000-000000000002'
const id = '00000000-0000-4000-8000-000000000003'
const otherId = '00000000-0000-4000-8000-000000000004'
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES ('${user}'),('${stranger}');
  CREATE TABLE credit_balances(user_id uuid PRIMARY KEY, balance int, lifetime_used int DEFAULT 0, updated_at timestamptz);
  INSERT INTO credit_balances(user_id,balance) VALUES ('${user}',100),('${stranger}',100);
  CREATE TABLE usage_logs(user_id uuid,api_key_id uuid,tool_name text,model_used text,credits_charged int,input_tokens int,output_tokens int,duration_ms int,source text,cache_read_tokens int,cache_write_tokens int);
  CREATE TABLE token_rates(model_id text PRIMARY KEY,display_name text,input_per_1m numeric,output_per_1m numeric,cache_read_per_1m numeric,cache_write_per_1m numeric,markup numeric,is_active boolean);
  CREATE TABLE credit_pricing(tool_name text PRIMARY KEY,supplier_cost numeric,credits int,is_free boolean);
  INSERT INTO credit_pricing VALUES ('edit_image_openai',0.1,20,false);
  GRANT USAGE ON SCHEMA public,auth TO service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public,auth TO service_role;
`)
const originalBilling = readFileSync('supabase/migrations/20260724123316_prevent_video_credit_overrefund.sql','utf8')
await db.exec(originalBilling.slice(0, originalBilling.indexOf('-- Marking a failed snapshot')))
await db.exec(readFileSync('supabase/migrations/20260903113857_media_pricing_catalog.sql','utf8'))
const count = await db.query('SELECT count(*)::int AS n FROM media_pricing')
assert.equal(count.rows[0].n, 65)
assert.equal((await db.query('SELECT count(*)::int AS n FROM token_rates')).rows[0].n,10)
assert.equal((await db.query("SELECT credits FROM credit_pricing WHERE tool_name='edit_image_openai'")).rows[0].credits,20)
await db.exec('SET ROLE service_role')
const quote = JSON.stringify({credits:30, priceId:'video:wan-3.0:480p:generate', priceVersion:'v1'})
async function reserve(requestId=id, owner=user, fingerprint='same', amount=quote) {
  return (await db.query('SELECT reserve_mcp_video($1,$2,NULL,$3,$4,$5,$6::jsonb) AS r', [requestId,owner,'makaron_create_video','wan-3.0',fingerprint,amount])).rows[0].r
}
async function balance(owner=user) { return (await db.query('SELECT balance FROM credit_balances WHERE user_id=$1',[owner])).rows[0].balance }
assert.equal((await reserve()).created,true)
assert.equal(await balance(),70)
assert.equal((await reserve()).created,false)
assert.equal(await balance(),70)
await assert.rejects(reserve(id,stranger), /conflict/)
await assert.rejects(reserve(id,user,'changed'), /conflict/)
await assert.rejects(reserve(otherId,user,'same',JSON.stringify({credits:100})), /insufficient_credits/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM mcp_video_reservations')).rows[0].n,1)
await db.query("SELECT finish_mcp_video_submission($1,$2,$3,'submitted')",[id,user,'task-1'])
await db.query('SELECT settle_mcp_video($1,$2,true)',[stranger,'task-1'])
assert.equal(await balance(),70)
await Promise.all(Array.from({length:5}, () => db.query('SELECT settle_mcp_video($1,$2,true)',[user,'task-1'])))
assert.equal(await balance(),100)
assert.equal((await db.query("SELECT count(*)::int AS n FROM usage_logs WHERE tool_name='refund:makaron_create_video'")).rows[0].n,1)
assert.equal((await reserve()).created,false)
assert.equal(await balance(),100)
// A completed job cannot later be refunded by a stale/error poll.
await reserve(otherId)
await db.query("SELECT finish_mcp_video_submission($1,$2,$3,'submitted')",[otherId,user,'task-2'])
await db.query('SELECT settle_mcp_video($1,$2,false)',[user,'task-2'])
await db.query('SELECT settle_mcp_video($1,$2,true)',[user,'task-2'])
assert.equal(await balance(),70)
// Synchronous completion is terminal in the same submission transaction.
const syncId = '00000000-0000-4000-8000-000000000005'
await reserve(syncId)
await db.query("SELECT finish_mcp_video_submission($1,$2,$3,'completed')",[syncId,user,'google-omni-task'])
await db.query('SELECT settle_mcp_video($1,$2,true)',[user,'google-omni-task'])
assert.equal(await balance(),40)
for (const role of ['anon','authenticated']) {
  await db.exec(`SET ROLE ${role}`)
  await assert.rejects(db.query('SELECT * FROM media_pricing'), /permission denied/)
  await assert.rejects(db.query('SELECT * FROM mcp_video_reservations'), /permission denied/)
  await assert.rejects(db.query('SELECT settle_mcp_video($1,$2,true)',[user,'task-2']), /permission denied/)
}
await db.exec('RESET ROLE')
const insecure = await db.query("SELECT proname FROM pg_proc WHERE proname IN ('reserve_mcp_video','finish_mcp_video_submission','settle_mcp_video') AND prosecdef")
assert.equal(insecure.rows.length,0)
await db.close()
console.log('PASS: 65 tariffs; atomic no-overdraft reservation; idempotent replay/refund; owner isolation; terminal-state monotonicity; service-only table/RPC access.')
