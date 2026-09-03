import { readFileSync } from 'node:fs'
import type { MediaPrice } from '@/lib/billing/media-pricing'
import type { TokenRate } from '@/lib/billing/token-rates'

export function seededMediaPrices(): MediaPrice[] {
  const sql = readFileSync('supabase/migrations/20260903113857_media_pricing_catalog.sql', 'utf8')
  return sql.split('\n').filter(line => /^\('(video|audio):/.test(line)).map(line => {
    const values = JSON.parse(`[${line.slice(1, line.lastIndexOf(')')).replaceAll("'", '"')}]`)
    const [id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier] = values
    return { id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier, is_active: true, updated_at: '2026-09-03T00:00:00Z' }
  })
}

export function seededTokenRates(): TokenRate[] {
  const sql = readFileSync('supabase/migrations/20260903113857_media_pricing_catalog.sql', 'utf8').split('INSERT INTO public.token_rates')[1].split('ON CONFLICT')[0]
  return sql.split('\n').filter(line => line.startsWith("('")).map(line => {
    const [model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active] = JSON.parse(`[${line.slice(1, line.lastIndexOf(')')).replaceAll("'", '"')}]`)
    return { model_id, display_name, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, markup, is_active }
  })
}
