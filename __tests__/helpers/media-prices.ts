import { readFileSync, readdirSync } from 'node:fs'
import type { MediaPrice } from '@/lib/billing/media-pricing'
import type { TokenRate } from '@/lib/billing/token-rates'

export function seededMediaPrices(): MediaPrice[] {
  const sql = readFileSync('supabase/migrations/20260903113857_media_pricing_catalog.sql', 'utf8')
  const existing: MediaPrice[] = sql.split('\n').filter(line => /^\('(video|audio):/.test(line)).map(line => {
    const values = JSON.parse(`[${line.slice(1, line.lastIndexOf(')')).replaceAll("'", '"')}]`)
    const [id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier] = values
    return { id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier, is_active: true, updated_at: '2026-09-03T00:00:00Z' }
  })
  const migration = readdirSync('supabase/migrations').find(file => file.endsWith('_h3_max_reference_token_pricing.sql'))!
  const additions = readFileSync('supabase/migrations/' + migration, 'utf8').split('\n').filter(line => line.startsWith("('video:fal-h3-max:")).map(line => {
    const [id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_1k_tokens, free_input_tokens, input_tokens_per_image_pixel, input_tokens_per_video_second, input_tokens_per_audio_second] = JSON.parse(`[${line.slice(1, line.lastIndexOf(')')).replaceAll("'", '"')}]`)
    return { id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_1k_tokens, free_input_tokens, input_tokens_per_image_pixel, input_tokens_per_video_second, input_tokens_per_audio_second, input_usd_per_second: 0, input_usd_per_image: 0, free_image_references: 0, markup: 2, unfiltered_multiplier: 1, is_active: true, updated_at: '2026-09-05T00:00:00Z' }
  })
  return [...existing, ...additions]
}

export function seededTokenRates(): TokenRate[] {
  const sql = readFileSync('supabase/migrations/20260903113857_media_pricing_catalog.sql', 'utf8').split('INSERT INTO public.token_rates')[1].split('ON CONFLICT')[0]
  return sql.split('\n').filter(line => line.startsWith("('")).map(line => {
    const [model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active] = JSON.parse(`[${line.slice(1, line.lastIndexOf(')')).replaceAll("'", '"')}]`)
    return { model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active }
  })
}
