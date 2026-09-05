'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n';

export default function CorePromptSwitch() {
  const { t } = useLocale();
  const [mode, setMode] = useState<'legacy' | 'layered' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/core-prompt', { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error('load');
        const data = await res.json();
        if (!['legacy', 'layered'].includes(data.mode)) throw new Error('mode');
        if (active) setMode(data.mode);
      }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  async function toggle() {
    if (!mode || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/admin/core-prompt', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode === 'layered' ? 'legacy' : 'layered' }),
      });
      if (!res.ok) throw new Error('save');
      const data = await res.json();
      if (!['legacy', 'layered'].includes(data.mode)) throw new Error('mode');
      setMode(data.mode);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4" data-testid="core-prompt-settings">
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-medium">{t('admin.corePrompt.title')}</h2>
        <p className="mt-1 text-sm text-white/70" aria-live="polite">
          {busy ? t('admin.corePrompt.saving') : mode === 'layered' ? t('admin.corePrompt.layered') : mode === 'legacy' ? t('admin.corePrompt.legacy') : t('admin.corePrompt.loading')}
        </p>
      </div>
      <button type="button" role="switch" aria-checked={mode === 'layered'}
        aria-label={t('admin.corePrompt.title')} disabled={!mode || busy} onClick={toggle}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${mode === 'layered' ? 'bg-fuchsia-600' : 'bg-white/20'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${mode === 'layered' ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
    <p className="mt-3 text-xs text-white/60">{t('admin.corePrompt.description')}</p>
    {failed && <p role="alert" className="mt-2 text-sm text-red-300">{t('admin.corePrompt.failed')}</p>}
  </section>;
}
