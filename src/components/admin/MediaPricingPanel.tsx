'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import type { MediaPrice } from '@/lib/billing/media-pricing'

const fields = ['output_usd_per_second', 'input_usd_per_second', 'input_usd_per_image', 'free_image_references', 'markup', 'unfiltered_multiplier'] as const

function PriceRow({ price, onSaved }: { price: MediaPrice; onSaved: (price: MediaPrice) => void }) {
  const { t } = useLocale()
  const [draft, setDraft] = useState(price)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'saved' | 'error' | 'conflict' | null>(null)
  async function save() {
    setBusy(true)
    setStatus(null)
    try {
      const response = await fetch('/api/admin/media-pricing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, updated_at: draft.updated_at, is_active: draft.is_active, ...Object.fromEntries(fields.map(field => [field, draft[field]])) }),
      })
      if (!response.ok) { setStatus(response.status === 409 ? 'conflict' : 'error'); return }
      const saved = await response.json() as MediaPrice
      setDraft(saved)
      onSaved(saved)
      setStatus('saved')
    } catch { setStatus('error') } finally { setBusy(false) }
  }
  return <tr className="border-b border-white/10">
    <td className="p-2 text-xs">{price.resolution}<br />{t(`mediaPricing.${price.operation as 'generate' | 'edit' | 'extend'}`)}</td>
    {fields.map(field => <td key={field} className="p-2">
      <input type="number" min={field === 'unfiltered_multiplier' ? 1 : 0} step={field === 'free_image_references' ? 1 : 'any'}
        aria-label={`${price.id} ${t(`mediaPricing.${field}`)}`} value={draft[field]} disabled={busy}
        onChange={event => { setDraft(previous => ({ ...previous, [field]: Number(event.target.value) })); setStatus(null) }}
        className="w-24 rounded bg-white/10 p-1 text-right text-xs" />
    </td>)}
    <td className="p-2"><input type="checkbox" checked={draft.is_active} disabled={busy} aria-label={`${price.id} ${t('mediaPricing.active')}`}
      onChange={event => setDraft(previous => ({ ...previous, is_active: event.target.checked }))} /></td>
    <td className="p-2 text-xs"><button onClick={save} disabled={busy} className="rounded bg-fuchsia-600 px-3 py-1 disabled:opacity-40">{t(busy ? 'mediaPricing.saving' : 'project.save')}</button>
      {status && <div role="status">{t(`mediaPricing.${status}`)}</div>}
    </td>
  </tr>
}

export default function MediaPricingPanel() {
  const { t } = useLocale()
  const [prices, setPrices] = useState<MediaPrice[]>([])
  const [model, setModel] = useState('')
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/admin/media-pricing', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() })
      .then((rows: MediaPrice[]) => { setPrices(rows); setModel(previous => previous || rows[0]?.model_id || ''); setState('ready') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [refresh])
  return <section className="mb-8" data-testid="media-pricing-panel">
    <h3 className="mb-2 text-sm font-medium">{t('mediaPricing.title')}</h3>
    <p className="mb-3 text-xs text-white/50">{t('mediaPricing.description')}</p>
    <p className="mb-3 text-xs text-white/50">{t('mediaPricing.included')}</p>
    <button onClick={() => setRefresh(value => value + 1)} className="mb-3 rounded bg-white/10 px-3 py-1 text-xs">{t('mediaPricing.refresh')}</button>
    {state !== 'ready' ? <p role="status">{t(state === 'loading' ? 'mediaPricing.loading' : 'mediaPricing.error')}</p> : <>
      <select aria-label={t('mediaPricing.model')} value={model} onChange={event => setModel(event.target.value)} className="mb-3 ml-3 rounded bg-white/10 p-1 text-sm">
        {[...new Set(prices.map(price => price.model_id))].map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <div className="overflow-x-auto rounded border border-white/10"><table className="w-full text-left">
        <thead className="text-xs text-white/60"><tr>
          <th className="p-2">{t('mediaPricing.variant')}</th>
          {fields.map(field => <th className="p-2" key={field}>{t(`mediaPricing.${field}`)}</th>)}
          <th className="p-2">{t('mediaPricing.active')}</th><th className="p-2">{t('project.save')}</th>
        </tr></thead>
        <tbody>{prices.filter(price => price.model_id === model).map(price => <PriceRow key={`${refresh}:${price.id}`} price={price}
          onSaved={saved => setPrices(previous => previous.map(row => row.id === saved.id ? saved : row))} />)}</tbody>
      </table></div>
    </>}
  </section>
}
