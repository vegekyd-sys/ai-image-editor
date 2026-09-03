// Scoped migration/acceptance helper. Never prints credentials or user prompts.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
} else throw new Error(`Unknown mode: ${mode}`)
