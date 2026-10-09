'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocaleToggle, useLocale } from '@/lib/i18n';
import type { MidjourneyRequest } from '@/lib/midjourney';
import type { localMidjourneyView } from '@/lib/midjourney-local-lab';

type Batch = ReturnType<typeof localMidjourneyView>;
type StyleSource = { id: string; index: number };
async function callApi(body?: unknown, id?: string) {
  const response = await fetch(`/api/local-midjourney${id ? `?id=${id}` : ''}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  if (!response.ok) throw new Error('request_failed');
  return response.json();
}

export default function MidjourneyLab() {
  const { t } = useLocale();
  const [brief, setBrief] = useState('');
  const [prepared, setPrepared] = useState<MidjourneyRequest | null>(null);
  const [preparedBrief, setPreparedBrief] = useState('');
  const [ratio, setRatio] = useState('');
  const [mode, setMode] = useState<'fast' | 'draft' | 'hd'>('fast');
  const [records, setRecords] = useState<Batch[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [selected, setSelected] = useState<number>(0);
  const [styleFrom, setStyleFrom] = useState<StyleSource>();
  const [busy, setBusy] = useState<'prepare' | 'submit' | null>(null);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const active = records.find(record => record.id === activeId) ?? records[0];
  const activeIds = records.filter(record => record.state === 'submitting' || (record.state === 'submitted' && !['completed', 'failed'].includes(record.status ?? ''))).map(record => record.id).join(',');

  const mergeRecord = useCallback((record: Batch) => {
    setRecords(previous => [record, ...previous.filter(item => item.id !== record.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);
  useEffect(() => {
    let cancelled = false;
    callApi().then(data => { if (!cancelled) setRecords(data.records); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!activeIds) return;
    let cancelled = false;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void Promise.all(activeIds.split(',').map(async id => {
        try { const record = await callApi(undefined, id); if (!cancelled) { mergeRecord(record); setError(false); } }
        catch { if (!cancelled) setError(true); }
      })).finally(() => { pending = false; });
    }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeIds, mergeRecord]);

  async function prepare() {
    const data = await callApi({ action: 'prepare', brief, hasStyleReference: Boolean(styleFrom) });
    setPrepared(data.request); setPreparedBrief(brief);
    return data.request as MidjourneyRequest;
  }
  async function showPrompt() {
    if (busy || !brief.trim()) return;
    setBusy('prepare'); setError(false);
    try { await prepare(); } catch { setError(true); } finally { setBusy(null); }
  }
  async function generate(hdFrom?: string) {
    if (busy || (!hdFrom && !brief.trim())) return;
    setBusy(prepared && preparedBrief === brief || hdFrom ? 'submit' : 'prepare'); setError(false);
    try {
      const plan = hdFrom ? {} : prepared && preparedBrief === brief ? prepared : await prepare();
      setBusy('submit');
      const record: Batch = await callApi({ action: 'submit', id: crypto.randomUUID(), brief: hdFrom ? active?.brief ?? brief : brief,
        request: { ...plan, ...(ratio ? { aspectRatio: ratio } : {}), speed: mode === 'draft' ? 'draft' : 'fast', quality: mode === 'hd' ? 'hd' : 'standard' },
        ...(hdFrom ? { hdFrom } : styleFrom ? { styleFrom } : {}),
      });
      mergeRecord(record); setActiveId(record.id); setSelected(0);
    } catch { setError(true); } finally { setBusy(null); }
  }
  async function refresh() {
    if (!active) return;
    setError(false);
    try { mergeRecord(await callApi(undefined, active.id)); } catch { setError(true); }
  }
  function chooseStyle(index: number) {
    if (!active) return;
    setStyleFrom({ id: active.id, index }); setSelected(index); setBrief(''); setPrepared(null); inputRef.current?.focus();
  }
  const estimatedCost = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(mode === 'hd' ? 0.12 : 0.08);
  const controls = 'rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400';
  const stateLabel = active?.state === 'unknown' ? t('mjLab.unknown') : active?.state === 'rejected' ? t('mjLab.failed') : active?.status === 'completed' ? t('mjLab.completed') : active?.status === 'failed' ? t('mjLab.failed') : t('mjLab.processing');
  return <main className="min-h-screen bg-[#101015] px-5 py-7 text-white md:px-10">
    <div className="mx-auto max-w-7xl">
      <header className="mb-9 flex items-center justify-between gap-4">
        <Link href="/home" className="text-sm text-white/65 hover:text-white">{t('mjLab.back')}</Link>
        <LocaleToggle />
      </header>
      <div className="mb-8"><p className="mb-2 text-xs font-medium uppercase tracking-[.2em] text-fuchsia-300">{t('mjLab.eyebrow')}</p><h1 className="text-3xl font-medium tracking-tight md:text-4xl">{t('mjLab.title')}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">{t('mjLab.subtitle')}</p></div>
      <div className="grid items-start gap-7 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[.025] p-5">
          <label className="block text-sm font-medium" htmlFor="mj-brief">{t('mjLab.brief')}</label>
          <textarea id="mj-brief" ref={inputRef} value={brief} disabled={Boolean(busy)} onChange={event => setBrief(event.target.value)} placeholder={t('mjLab.placeholder')} rows={6} maxLength={4000} className={`${controls} w-full resize-y leading-6`} />
          {styleFrom ? <div className="flex items-center justify-between gap-3 rounded-xl bg-fuchsia-400/10 p-3 text-sm text-fuchsia-200"><span>{t('mjLab.styleActive')}</span><button onClick={() => { setStyleFrom(undefined); setPrepared(null); }} disabled={Boolean(busy)}>{t('mjLab.clearStyle')}</button></div> : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-xs text-white/65"><span>{t('mjLab.ratio')}</span><select value={ratio} onChange={event => setRatio(event.target.value)} disabled={Boolean(busy)} className={`${controls} w-full`}><option value="">{t('mjLab.auto')}</option>{['1:1', '16:9', '9:16', '4:5', '3:2'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="space-y-2 text-xs text-white/65"><span>{t('mjLab.mode')}</span><select value={mode} onChange={event => setMode(event.target.value as typeof mode)} disabled={Boolean(busy)} className={`${controls} w-full`}><option value="fast">{t('mjLab.fast')}</option><option value="draft">{t('mjLab.draft')}</option><option value="hd">{t('mjLab.hd')}</option></select></label>
          </div>
          <p className="text-xs leading-5 text-white/45">{t('mjLab.cost')} {estimatedCost} · {t('mjLab.localNote')}</p>
          <div className="flex gap-2"><button onClick={() => void showPrompt()} disabled={Boolean(busy) || !brief.trim()} className={`${controls} disabled:opacity-35`}>{busy === 'prepare' ? t('mjLab.preparing') : t('mjLab.showPrompt')}</button><button onClick={() => void generate()} disabled={Boolean(busy) || !brief.trim()} className="flex-1 rounded-xl bg-fuchsia-300 px-4 py-2 text-sm font-semibold text-black hover:bg-fuchsia-200 disabled:opacity-35">{busy ? t('mjLab.working') : t('mjLab.generate')}</button></div>
          {prepared ? <div className="space-y-2"><label htmlFor="mj-prompt" className="text-xs text-white/65">{t('mjLab.prompt')}</label><textarea id="mj-prompt" value={prepared.prompt} maxLength={1024} disabled={Boolean(busy)} rows={5} onChange={event => setPrepared({ ...prepared, prompt: event.target.value })} className={`${controls} w-full resize-y text-xs leading-5`} /><p className="text-xs text-white/45">{t('mjLab.promptHint')}</p></div> : null}
          {error ? <p role="alert" className="text-sm leading-6 text-rose-300">{t('mjLab.error')}</p> : null}
          <div className="border-t border-white/10 pt-4"><h2 className="mb-3 text-xs font-medium text-white/50">{t('mjLab.history')}</h2><div className="max-h-60 space-y-2 overflow-y-auto">{records.map(record => <button key={record.id} onClick={() => { setActiveId(record.id); setSelected(0); }} aria-pressed={active?.id === record.id} className={`w-full rounded-xl px-3 py-2 text-left text-xs ${active?.id === record.id ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'}`}><span className="block truncate">{record.brief}</span><span className="mt-1 block text-white/35">{new Date(record.createdAt).toLocaleTimeString()} · {record.cost !== undefined ? `$${record.cost}` : t('mjLab.processing')}</span></button>)}</div></div>
        </section>
        <section aria-live="polite" className="min-w-0">
          {active ? <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-medium">{stateLabel}{active.progress !== undefined && active.status !== 'completed' ? ` · ${active.progress}%` : ''}</h2><p className="mt-1 text-xs text-white/45">{active.cost !== undefined ? `${t('mjLab.actualCost')} $${active.cost}` : t('mjLab.waitHint')}</p></div><button className={controls} onClick={() => void refresh()}>{t('mjLab.refresh')}</button></div>
            <p className="mb-5 text-sm leading-6 text-white/55">{active.brief}</p>
            {active.images.length ? <><div className={`grid gap-4 ${active.images.length > 4 ? 'grid-cols-2 md:grid-cols-3' : 'md:grid-cols-2'}`}>{active.images.map(image => <article key={image.index} className={`overflow-hidden rounded-xl border ${selected === image.index ? 'border-fuchsia-300/70' : 'border-white/10'}`}><button className="block w-full" onClick={() => setSelected(image.index)} aria-label={`${t('mjLab.select')} ${image.index + 1}`} aria-pressed={selected === image.index}><img src={image.url} alt={`${t('mjLab.candidate')} ${image.index + 1}`} className="aspect-video w-full bg-white/5 object-contain" loading="lazy" /></button><div className="flex items-center justify-between gap-2 bg-white/[.03] px-3 py-2 text-xs"><span className="text-white/45">{t('mjLab.candidate')} {image.index + 1}</span><button onClick={() => chooseStyle(image.index)} disabled={Boolean(busy)} className="text-fuchsia-200">{t('mjLab.useStyle')}</button><a href={`${image.url}&download=1`} download>{t('mjLab.download')}</a></div></article>)}</div><div className="mt-5 flex flex-wrap items-center gap-4"><button className={controls} disabled={Boolean(busy)} onClick={() => void generate(active.id)}>{t('mjLab.generateHd')}</button><p className="text-xs text-white/45">{t('mjLab.hdNote')}</p></div></> : <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm leading-7 text-white/45">{active.state === 'unknown' ? t('mjLab.unknownHint') : active.state === 'rejected' || active.status === 'failed' ? t('mjLab.failedHint') : t('mjLab.waitHint')}</div>}
          </> : <div className="flex min-h-[450px] items-center justify-center rounded-2xl border border-dashed border-white/15 p-9 text-center"><div><p className="text-xl font-light text-white/70">{t('mjLab.emptyTitle')}</p><p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-white/40">{t('mjLab.emptyHint')}</p></div></div>}
        </section>
      </div>
    </div>
  </main>;
}
