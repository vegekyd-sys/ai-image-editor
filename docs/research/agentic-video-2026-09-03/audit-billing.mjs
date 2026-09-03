// Read-only ledger audit, scoped to the CLI user's key and video-analysis tools.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const name of ['--env', '--since', '--out']) if (!args.includes(name)) throw new Error(`${name} required`);
const key = process.env.MAKARON_API_KEY || JSON.parse(await readFile(`${process.env.HOME}/.makaron/auth.json`, 'utf8'))._apiKey;
if (!key?.startsWith('mk_live_')) throw new Error('A per-user Makaron API key is required for billing verification.');
process.loadEnvFile(arg('--env'));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: identity, error } = await db.from('api_keys').select('id,user_id')
  .eq('key_hash', createHash('sha256').update(key).digest('hex')).single();
if (error) throw new Error(error.message);
const { data: rows, error: ledgerError } = await db.from('usage_logs')
  .select('created_at,tool_name,model_used,input_tokens,output_tokens,cache_read_tokens,credits_charged,duration_ms,source')
  .eq('user_id', identity.user_id).eq('api_key_id', identity.id)
  .in('tool_name', ['makaron_analyze_video', 'analyze_video'])
  .gte('created_at', arg('--since')).order('created_at', { ascending: true });
if (ledgerError) throw new Error(ledgerError.message);
// No key IDs, user IDs, credentials or media URLs are written to the report.
const result = { checkedAt: new Date().toISOString(), since: arg('--since'), scope: 'Current CLI key, analyze_video only', rows };
await writeFile(arg('--out'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
