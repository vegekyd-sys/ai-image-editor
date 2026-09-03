'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import type { MediaPrice } from '@/lib/billing/media-pricing'
import { listVideoModelCapabilities } from '@/lib/video-model-capabilities'

const fields = ['output_usd_per_second', 'markup', 'input_usd_per_second', 'input_usd_per_image', 'free_image_references', 'unfiltered_multiplier'] as const
const modelLabels = new Map(listVideoModelCapabilities().map(model => [model.id, model.label]))
// i18n-ignore: model brand, not interface copy.
modelLabels.set('evolink-seed-audio', 'Seed Audio')
const modelLabel = (id: string) => modelLabels.get(id) || id
const focusStyle = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black'
const formatCost = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 })

function PriceEntry({ price, editing, editingElsewhere, onEdit, onSaved }: {
  price: MediaPrice
  editing: boolean
  editingElsewhere: boolean
  onEdit: (id: string | null) => void
  onSaved: (price: MediaPrice) => void
}) {
  const { t } = useLocale()
  const [draft, setDraft] = useState(price)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'saved' | 'error' | 'conflict' | null>(null)
  const dirty = fields.some(field => draft[field] !== price[field]) || draft.is_active !== price.is_active
  const resolution = price.resolution === 'default' ? t('mediaPricing.defaultResolution') : price.resolution.toUpperCase()
  const sampleCredits = Math.ceil(price.output_usd_per_second * 5 * 100 * price.markup - 1e-9)

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
      onEdit(null)
      setStatus('saved')
    } catch { setStatus('error') } finally { setBusy(false) }
  }

  return <div className={`border-t border-white/10 px-4 py-4 sm:px-5 ${editing ? 'bg-white/[0.03]' : ''}`} data-testid={`media-price-${price.id}`}>
    <div className="grid grid-cols-2 items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(90px,1fr)_minmax(100px,1fr)_minmax(90px,1fr)_auto]">
      <div className="order-1 min-w-0">
        <div className="text-sm font-semibold text-white">{resolution}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/55">
          {t(`mediaPricing.${price.operation as 'generate' | 'edit' | 'extend'}`)}
          {!price.is_active && <span className="text-amber-300">{t('mediaPricing.inactive')}</span>}
        </div>
      </div>
      <div className="order-3 sm:order-2">
        <div className="text-xs text-white/50">{t('mediaPricing.output_usd_per_second')}</div>
        <div className="mt-1 break-words text-sm tabular-nums text-white/90">${formatCost(price.output_usd_per_second)} <span className="ml-1 text-xs text-white/45">×{price.markup}</span></div>
      </div>
      <div className="order-4 sm:order-3">
        <div className="text-xs text-white/50">{t('mediaPricing.sample5s')}</div>
        <div className="mt-1 text-sm font-semibold tabular-nums text-fuchsia-300">{price.is_active ? t('mediaPricing.quoteCredits').replace('{credits}', String(sampleCredits)) : '—'}</div>
      </div>
      <button type="button" disabled={editingElsewhere || busy} aria-expanded={editing}
        onClick={() => { setDraft(price); setStatus(null); onEdit(editing ? null : price.id) }}
        className={`order-2 justify-self-end rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75 hover:border-white/30 hover:bg-white/5 disabled:opacity-35 sm:order-4 ${focusStyle}`}>
        {t(editing ? 'mediaPricing.cancel' : 'mediaPricing.editPrice')}
      </button>
    </div>
    {editing && <form onSubmit={event => { event.preventDefault(); void save() }} className="mt-5 border-t border-white/10 pt-4">
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-3">
        {fields.map(field => <label key={field} className="min-w-0 text-xs text-white/65">
          {t(`mediaPricing.${field}`)}
          <input type="number" required min={field === 'unfiltered_multiplier' ? 1 : field === 'markup' || field === 'output_usd_per_second' ? 0.000001 : 0}
            step={field === 'free_image_references' ? 1 : 'any'} aria-label={`${price.id} ${t(`mediaPricing.${field}`)}`} value={draft[field]}
            onChange={event => { setDraft(previous => ({ ...previous, [field]: Number(event.target.value) })); setStatus(null) }}
            className={`mt-2 w-full min-w-0 rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm tabular-nums text-white ${focusStyle}`} />
        </label>)}
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input type="checkbox" checked={draft.is_active} disabled={busy} aria-label={`${price.id} ${t('mediaPricing.active')}`}
            onChange={event => { setDraft(previous => ({ ...previous, is_active: event.target.checked })); setStatus(null) }} className="size-4 accent-fuchsia-500" />
          {t('mediaPricing.active')}
        </label>
        <button type="submit" disabled={busy || !dirty} className={`rounded-lg bg-fuchsia-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-fuchsia-500 disabled:opacity-35 ${focusStyle}`}>
          {t(busy ? 'mediaPricing.saving' : 'project.save')}
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-amber-200/80">{t('mediaPricing.sharedDatabase')}</p>
    </form>}
    {status && <p role="status" className={`mt-3 text-xs ${status === 'saved' ? 'text-emerald-300' : 'text-amber-200'}`}>{t(`mediaPricing.${status}`)}</p>}
  </div>
}

export default function MediaPricingPanel() {
  const { t } = useLocale()
  const [prices, setPrices] = useState<MediaPrice[]>([])
  const [selection, setSelection] = useState<{ kind: MediaPrice['kind']; model: string }>({ kind: 'video', model: '' })
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/admin/media-pricing', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() })
      .then((rows: MediaPrice[]) => {
        if (controller.signal.aborted) return
        setPrices(rows)
        setSelection(previous => {
          const selected = rows.find(row => row.model_id === previous.model && row.kind === previous.kind)
            || rows.find(row => row.kind === 'video') || rows[0]
          return selected ? { kind: selected.kind, model: selected.model_id } : { kind: 'video', model: '' }
        })
        setState('ready')
      })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [refresh])

  const models = [...new Set(prices.filter(price => price.kind === selection.kind).map(price => price.model_id))]
  const visibleModels = models.filter(id => `${modelLabel(id)} ${id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const rows = prices.filter(price => price.model_id === selection.model && price.kind === selection.kind)
    .sort((a, b) => {
      const resolutionOrder = ['default', '360p', '480p', '720p', '768p', '1080p', '2k', '4k']
      return resolutionOrder.indexOf(a.resolution) - resolutionOrder.indexOf(b.resolution)
        || ['generate', 'edit', 'extend'].indexOf(a.operation) - ['generate', 'edit', 'extend'].indexOf(b.operation)
    })

  return <section className="mb-8" data-testid="media-pricing-panel">
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-white">{t('mediaPricing.title')}</h3>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-white/55">{t('mediaPricing.description')}</p>
      </div>
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={Boolean(editing) || state === 'loading'}
        className={`shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75 hover:bg-white/5 disabled:opacity-35 ${focusStyle}`}>
        {t('mediaPricing.refresh')}
      </button>
    </div>
    {state !== 'ready' ? <p role="status" className="rounded-xl border border-white/10 p-6 text-sm text-white/65">{t(state === 'loading' ? 'mediaPricing.loading' : 'mediaPricing.error')}</p>
      : !prices.length ? <p role="status" className="py-5 text-sm text-white/65">{t('mediaPricing.empty')}</p>
      : <div className="grid min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101012] md:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-white/10 p-3 md:border-b-0 md:border-r">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-black/50 p-1" role="group" aria-label={t('mediaPricing.category')}>
            {(['video', 'audio'] as const).map(kind => <button key={kind} type="button" aria-pressed={selection.kind === kind} disabled={Boolean(editing)}
              onClick={() => { setSelection({ kind, model: prices.find(price => price.kind === kind)?.model_id || '' }); setQuery('') }}
              className={`rounded-md py-2 text-xs font-medium disabled:opacity-35 ${selection.kind === kind ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'} ${focusStyle}`}>
              {t(`mediaPricing.${kind}`)} <span className="ml-1 text-white/40">{new Set(prices.filter(price => price.kind === kind).map(price => price.model_id)).size}</span>
            </button>)}
          </div>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('mediaPricing.searchModels')} aria-label={t('mediaPricing.searchModels')}
            className={`mb-3 w-full min-w-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-white/40 ${focusStyle}`} />
          <nav aria-label={t('mediaPricing.model')} className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto md:max-h-[520px] md:grid-cols-1">
            {visibleModels.map(id => <button type="button" key={id} aria-pressed={selection.model === id} disabled={Boolean(editing)}
              onClick={() => setSelection(previous => ({ ...previous, model: id }))}
              className={`min-w-0 rounded-lg border px-3 py-2.5 text-left text-xs leading-relaxed disabled:opacity-40 ${selection.model === id ? 'border-fuchsia-400/25 bg-fuchsia-500/10 font-medium text-fuchsia-200' : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'} ${focusStyle}`}>
              {modelLabel(id)}
            </button>)}
          </nav>
          {!visibleModels.length && <p role="status" className="px-2 py-4 text-xs text-white/50">{t('mediaPricing.noModels')}</p>}
        </aside>
        <div className="min-w-0">
          <div className="px-4 py-5 sm:px-5">
            <h4 className="text-base font-semibold text-white">{modelLabel(selection.model)}</h4>
            <p className="mt-1 break-all text-xs text-white/40">{selection.model}</p>
            <p className="mt-3 text-xs leading-relaxed text-white/55">{t('mediaPricing.sampleExplanation')}</p>
          </div>
          {rows.map(price => <PriceEntry key={`${refresh}:${price.id}`} price={price} editing={editing === price.id} editingElsewhere={Boolean(editing && editing !== price.id)} onEdit={setEditing}
            onSaved={saved => setPrices(previous => previous.map(row => row.id === saved.id ? saved : row))} />)}
          {!rows.length && <p role="status" className="px-5 pb-5 text-xs text-white/55">{t('mediaPricing.empty')}</p>}
        </div>
      </div>}
    <p className="mt-3 text-xs leading-relaxed text-white/40">{t('mediaPricing.included')}</p>
  </section>
}
