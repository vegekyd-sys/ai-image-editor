// Read the same production-linked database as the local Makaron monitor.
// Only return terminal failure metadata. Raw error text stays in the database.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {parseEnv} from 'node:util'

const [checkout, from, to] = process.argv.slice(2)
const env = (file) => parseEnv(readFileSync(join(checkout, file), 'utf8'))
const project = new URL(env('.env.vercel-prod').NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const token = env('.env.local').SUPABASE_ACCESS_TOKEN
const timestamp = (seconds) => new Date(Number(seconds) * 1000).toISOString()
const start = timestamp(from), end = timestamp(to)
const query = String.raw`select coalesce(json_agg(f order by f.at,f.id),'[]'::json) as failures from (
  select j.id,j.project_id,extract(epoch from j.completed_at)::float8 as at,
    case when j.error ilike '%dimensions, audio or duration validation%' then 'media_validation'
         when j.error ilike '%Source changed while preparing export%' then 'source_changed'
         when j.error ilike '%NoSuchKey%' then 'missing_object'
         when j.error ilike '%media preparation%' and j.error ~* 'deadline|timed? ?out' then 'preparation_timeout'
         else 'other_' || md5(regexp_replace(lower(coalesce(nullif(trim(j.error),''),'unspecified')),
           'https?://[^[:space:]]+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]+(\.[0-9]+)?','[value]','g')) end as family
  from public.remotion_export_jobs j
  where j.output_type='video' and j.status='failed'
    and j.completed_at between '${start}' and '${end}'
    and coalesce((select a.metadata->>'executionOwnerOrigin' from public.agent_runs a
           where a.project_id=j.project_id and a.started_at<=j.completed_at
             and a.metadata->>'executionOwnerOrigin' is not null
           order by a.started_at desc limit 1),'') in ('','https://www.makaron.app','https://makaron.app')
) f`
const response = await fetch('https://api.supabase.com/v1/projects/'+project+'/database/query/read-only', {
  method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query}), signal:AbortSignal.timeout(18000)
})
if (!response.ok) throw Error('export_query_http_'+response.status)
const [result] = await response.json()
if (!Array.isArray(result?.failures)) throw Error('invalid_export_result')
console.log(JSON.stringify(result.failures))
