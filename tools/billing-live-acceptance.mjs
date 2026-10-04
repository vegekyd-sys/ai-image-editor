// Scoped migration/acceptance helper. Never prints credentials or user prompts.
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const env = parse(readFileSync('/Users/tianyicai/ai-image-editor/.env.local', 'utf8'))
const ref = readFileSync('/Users/tianyicai/ai-image-editor/supabase/.temp/project-ref', 'utf8').trim()
const serviceClaims = JSON.parse(Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString())
if (!/^[a-z]{20}$/.test(ref) || serviceClaims.ref !== ref) throw new Error('Linked project and service-role credential disagree.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const auth = JSON.parse(readFileSync(resolve(homedir(), '.makaron/auth.json'), 'utf8'))
const key = process.env.MAKARON_API_KEY || auth._apiKey
const version = '20260903113857'
const migrationFile = `supabase/migrations/${version}_media_pricing_catalog.sql`
const migrationSql = readFileSync(migrationFile, 'utf8')
const hash = createHash('sha256').update(migrationSql).digest('hex')
const mode = process.argv[2] || 'inspect'

async function management(path, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`Management ${path}: HTTP ${response.status}: ${(await response.text()).slice(0,1200)}`)
  return response.json()
}
const query = (sql, parameters = []) => management('database/query', { query: sql, parameters, read_only: true })
const sqlString = value => `'${value.replaceAll("'", "''")}'`
const output = value => console.log(JSON.stringify(value, null, 2))
const base = process.env.MAKARON_URL || 'http://localhost:3042'

async function localApi(path, body) {
  if (new URL(base).hostname !== 'localhost' || new URL(base).port !== '3042') throw new Error('Live acceptance helper is restricted to localhost:3042.')
  const startedAt = new Date().toISOString()
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(240_000),
  })
  const result = await response.json()
  if (result.result?.content) result.result.content = result.result.content.map(item => item.type === 'image' ? {type:item.type,mimeType:item.mimeType,bytes:item.data.length} : item)
  return { startedAt, finishedAt: new Date().toISOString(), httpStatus: response.status, remaining: response.headers.get('X-Credits-Remaining'), result }
}

async function owner() {
  const { data, error } = await db.from('api_keys').select('id,user_id').eq('key_hash', createHash('sha256').update(key).digest('hex')).eq('is_active',true).single()
  if (error || !data) throw new Error('CLI credential is not an active user API key.')
  return data
}
async function inspection() {
  const objects = await query("select to_regclass('public.media_pricing')::text as media_table, to_regclass('public.mcp_video_reservations')::text as reservations, to_regclass('supabase_migrations.schema_migrations')::text as migration_history")
  const history = await query('select version,name from supabase_migrations.schema_migrations where version=$1', [version])
  const settings = await query("select key,value from public.app_settings where key='billing_enabled'")
  const currentOwner = await owner()
  const balance = await db.from('credit_balances').select('balance,lifetime_used').eq('user_id',currentOwner.user_id).single()
  const columns = await query("select table_name,column_name,data_type from information_schema.columns where table_schema in ('public','supabase_migrations') and table_name in ('schema_migrations','token_rates','credit_pricing','usage_logs') order by table_name,ordinal_position")
  return { projectRef: ref, version, sha256: hash, objects, history, settings, balance: balance.data, columns }
}

if (mode === 'inspect') output(await inspection())
else if (mode === 'migrate') {
  if (process.argv[3] !== ref || process.argv[4] !== hash) throw new Error('Pass the inspected project ref and SQL SHA256 to authorize this exact migration.')
  const inspected = await inspection()
  if (inspected.history.length || inspected.objects[0].media_table || inspected.objects[0].reservations) throw new Error('Migration or tables already exist. Verify existing state; do not reapply.')
  const queryText = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'; SELECT pg_advisory_xact_lock(hashtext('makaron_media_pricing_catalog'));\n${migrationSql}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${sqlString(version)},'media_pricing_catalog',ARRAY[${sqlString(migrationSql)}]); COMMIT;`
  await management('database/query', { query: queryText, read_only: false })
  output({ migrated: version, projectRef: ref, sha256: hash })
} else if (mode === 'catalog') {
  output(await query("select kind,model_id,count(*)::int as variants from public.media_pricing group by kind,model_id order by kind,model_id"))
  output(await query("select relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT') as anon_read,has_table_privilege('authenticated',oid,'SELECT') as authenticated_read from pg_class where oid in ('public.media_pricing'::regclass,'public.mcp_video_reservations'::regclass)"))
  output(await query("select version,name from supabase_migrations.schema_migrations where version=$1",[version]))
} else if (mode === 'ledger') {
  const currentOwner = await owner()
  const since = process.argv[3]
  if (!since || !Number.isFinite(Date.parse(since))) throw new Error('An ISO start time is required.')
  const logs = await db.from('usage_logs').select('id,tool_name,model_used,credits_charged,input_tokens,output_tokens,source,created_at').eq('user_id',currentOwner.user_id).gte('created_at',since).order('created_at').limit(300)
  const reservations = await db.from('mcp_video_reservations').select('id,model_id,status,credits,task_id,quote,created_at').eq('user_id',currentOwner.user_id).gte('created_at',since).order('created_at')
  const balance = await db.from('credit_balances').select('balance,lifetime_used').eq('user_id',currentOwner.user_id).single()
  if (logs.error || reservations.error || balance.error) throw new Error('Ledger query failed')
  output({balance:balance.data,logs:logs.data,reservations:reservations.data})
} else if (mode === 'advisors') {
  const result = await management('advisors/security')
  const lints = result.lints ?? result
  output({ allCount: Array.isArray(lints) ? lints.length : undefined, relevant: Array.isArray(lints) ? lints.filter(item => /media_pricing|mcp_video|reserve_mcp|finish_mcp|settle_mcp/.test(JSON.stringify(item))) : result })
} else if (mode === 'verify-receipts') {
  // Fixed receipts from the authorized 2026-09-03 run; this mode is read-only.
  const currentOwner = await owner()
  const cases = [
    {id:'5809d2f2-846a-4654-9d77-47124907910a',kind:'token',price:'deepseek/deepseek-v4-pro'},
    {id:'4bc919c9-5368-4c4e-a3d4-d5a74b819486',kind:'token',price:'google/gemini-3.1-flash-lite-image'},
    {id:'c6eb6f8e-d351-474d-ae01-43d48d6e8b28',kind:'action',price:'edit_image_qwen'},
    {id:'48cd244c-c848-4481-9f4f-1ada46f3041b',kind:'media',price:'audio:evolink-seed-audio:default:generate',seconds:3},
    {id:'dbeb59fa-1a2b-4c44-8d5d-95cf6c49a145',kind:'media',price:'video:wan-3.0:480p:generate',seconds:2},
    {id:'4306f2f4-bc5c-4d1b-9cad-c139ca5e7327',kind:'media',price:'video:wan-3.0-prime:480p:generate',seconds:2},
    {id:'662aa3a2-0750-4707-8c86-6b8c8f9b39bd',kind:'media',price:'video:wan-3.0:480p:generate',seconds:2},
  ]
  const tokenPrices = await query('select model_id,input_per_1m,output_per_1m,cache_read_per_1m,cache_write_per_1m,markup from public.token_rates where is_active=true')
  const actionPrices = await query("select tool_name,credits from public.credit_pricing where tool_name='edit_image_qwen'")
  const mediaPrices = await query('select id,output_usd_per_second,markup,updated_at from public.media_pricing where is_active=true')
  const {data:logs,error} = await db.from('usage_logs').select('id,tool_name,model_used,credits_charged,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens').eq('user_id',currentOwner.user_id).in('id',cases.map(item=>item.id))
  if (error || logs.length !== cases.length) throw new Error('Missing acceptance receipts')
  const receipts = cases.map(item => {
    const log = logs.find(row=>row.id===item.id)
    const price = item.kind === 'token' ? tokenPrices.find(row=>row.model_id===item.price)
      : item.kind === 'action' ? actionPrices.find(row=>row.tool_name===item.price)
      : mediaPrices.find(row=>row.id===item.price)
    if (!price) throw new Error(`Missing exact registered price: ${item.price}`)
    const expected = item.kind === 'action' ? Number(price.credits)
      : item.kind === 'media' ? Math.ceil(item.seconds * Number(price.output_usd_per_second) * Number(price.markup) * 100 - 1e-9)
      : Math.ceil((Number(log.input_tokens) * Number(price.input_per_1m)
        + Number(log.output_tokens) * Number(price.output_per_1m)
        + Number(log.cache_read_tokens) * Number(price.cache_read_per_1m ?? price.input_per_1m)
        + Number(log.cache_write_tokens) * Number(price.cache_write_per_1m ?? price.input_per_1m)) * Number(price.markup) / 10_000)
    if (expected !== log.credits_charged) throw new Error(`Receipt ${item.id}: expected ${expected}, actual ${log.credits_charged}`)
    return {...log,price,expected,passed:true}
  })
  const invalid = await query('select count(*)::int as count from public.mcp_video_reservations where id=$1',['03705a54-01f3-4000-8000-202609030099'])
  if (invalid[0].count !== 0) throw new Error('Invalid request unexpectedly reserved credits')
  const replay = await query("select count(*)::int as count from public.usage_logs where user_id=$1 and tool_name='makaron_create_video' and model_used='wan-3.0' and created_at >= '2026-09-03T12:35:50Z' and created_at < '2026-09-03T12:44:00Z'",[currentOwner.user_id])
  if (replay[0].count !== 1) throw new Error('Expected exactly one Standard MCP charge during original/replay window')
  output({passed:true,totalCredits:receipts.reduce((sum,row)=>sum+row.credits_charged,0),invalidRequestReservations:invalid[0].count,standardMcpChargeCount:replay[0].count,receipts})
} else if (mode === 'mcp') {
  const name = process.argv[3]
  const args = JSON.parse(process.argv[4] || '{}')
  output(await localApi('/api/mcp', {jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}))
} else if (mode === 'api') {
  output(await localApi(process.argv[3], process.argv[4] ? JSON.parse(process.argv[4]) : undefined))
} else if (mode === 'transaction-check') {
  if (process.argv[3] !== 'rollback-only') throw new Error('This SQL self-test must use rollback-only mode.')
  const currentOwner = await owner()
  const id = randomUUID()
  const task = `billing-acceptance-${id}`
  const quote = JSON.stringify({credits:1,priceId:'acceptance-only',priceVersion:'rollback-only'})
  const sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
  DO $test$ DECLARE original_balance integer; original_used integer; replay jsonb; BEGIN
    SELECT balance,lifetime_used INTO STRICT original_balance,original_used FROM public.credit_balances WHERE user_id='${currentOwner.user_id}' FOR UPDATE;
    PERFORM public.reserve_mcp_video('${id}','${currentOwner.user_id}','${currentOwner.id}','${task}','qa','same',${sqlString(quote)}::jsonb);
    replay := public.reserve_mcp_video('${id}','${currentOwner.user_id}','${currentOwner.id}','${task}','qa','same',${sqlString(quote)}::jsonb);
    IF replay->>'created' <> 'false' THEN RAISE EXCEPTION 'Replay incorrectly created a second charge'; END IF;
    IF (SELECT balance FROM public.credit_balances WHERE user_id='${currentOwner.user_id}') <> original_balance-1 THEN RAISE EXCEPTION 'Reservation amount mismatch'; END IF;
    PERFORM public.finish_mcp_video_submission('${id}','${currentOwner.user_id}','${task}','submitted');
    PERFORM public.settle_mcp_video('${currentOwner.user_id}','${task}',true);
    PERFORM public.settle_mcp_video('${currentOwner.user_id}','${task}',true);
    IF (SELECT balance FROM public.credit_balances WHERE user_id='${currentOwner.user_id}') <> original_balance THEN RAISE EXCEPTION 'Refund mismatch'; END IF;
    IF (SELECT lifetime_used FROM public.credit_balances WHERE user_id='${currentOwner.user_id}') <> original_used THEN RAISE EXCEPTION 'Lifetime usage mismatch'; END IF;
    IF (SELECT count(*) FROM public.usage_logs WHERE tool_name='refund:${task}') <> 1 THEN RAISE EXCEPTION 'Refund must be logged exactly once'; END IF;
    BEGIN
      PERFORM public.reserve_mcp_video('${randomUUID()}','${currentOwner.user_id}','${currentOwner.id}','${task}','qa','too-expensive','{"credits":2147483647}'::jsonb);
      RAISE EXCEPTION 'Overdraft unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%insufficient_credits%' THEN RAISE; END IF;
    END;
  END $test$;
  ROLLBACK;`
  await management('database/query', {query:sql,read_only:false})
  const leftovers = await query('select count(*)::int as count from public.mcp_video_reservations where id=$1',[id])
  if (leftovers[0].count !== 0) throw new Error('Rollback did not remove test reservation')
  output({passed:true,checks:['atomic_reservation','replay','single_refund','insufficient_balance','rollback_no_persistent_test_rows']})
} else throw new Error(`Unknown mode: ${mode}`)
