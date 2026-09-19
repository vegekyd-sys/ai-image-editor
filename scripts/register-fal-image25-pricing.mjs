/** Add only absent Image 2.5 rows; preserve operator changes and the existing Image 2 markup.
 * node --env-file=<private-env> scripts/register-fal-image25-pricing.mjs
 * token counters are descriptive; runtime charges the exact fal billable-unit cost.
 */
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: baseline, error } = await admin.from('token_rates').select('markup,is_active').eq('model_id', 'openai/gpt-image-2').single();
if (error || !baseline?.is_active || !Number.isFinite(baseline.markup) || baseline.markup <= 0) throw new Error('An active Image 2 baseline with a valid markup is required.');
const rows = ['flare', 'sunburst'].map(variant => ({
  model_id: `gpt-image-2.5-${variant}`,
  display_name: `GPT Image 2.5 ${variant === 'flare' ? 'Flare' : 'Sunburst'} (fal)`,
  input_per_1m: 8, output_per_1m: 30, cache_read_per_1m: 2, cache_write_per_1m: 8,
  markup: baseline.markup, is_active: true,
}));
const { error: writeError } = await admin.from('token_rates').upsert(rows, { onConflict: 'model_id', ignoreDuplicates: true });
if (writeError) throw new Error('Could not register Image 2.5 pricing.');
const { data, error: readError } = await admin.from('token_rates').select('model_id,markup,is_active').in('model_id', rows.map(row => row.model_id));
if (readError || data?.length !== 2 || data.some(row => !row.is_active || !Number.isFinite(row.markup) || row.markup <= 0)) throw new Error('Image 2.5 pricing verification failed.');
console.log(JSON.stringify(data, null, 2));
