'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n';

/** Collapsible card showing a submitted prompt, or a labeled legacy MJ brief. */
export default function ImagePromptCard({ prompt, inputImages, editModel, isBrief, compact }: { prompt: string; inputImages?: string[]; editModel?: string; isBrief?: boolean; compact?: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const inputImageLabels = [t('chat.currentImage'), t('chat.referenceImage')];
  const modelLabels: Record<string, string> = { 'mj-v8.2': 'Midjourney V8.2', gemini: 'nano banana 2', 'gemini-2.1': 'nano banana 2.1', 'gemini-lite': 'nano banana 2 lite', 'qwen-spicy': 'qwen spicy', openai: 'OpenAI Image 2', 'gpt-image-2.5-flare': 'GPT Image 2.5 Flare', 'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst', 'wan2.7-image': 'Wan 2.7 Image' };
  const modelLabel = modelLabels[editModel || ''] || editModel || 'model';
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', maxWidth: 308 }}>
      <button
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left active:opacity-70 transition-opacity"
      >
        {/* Reference image thumbnail in collapsed header */}
        {!open && inputImages?.[0] && inputImages[0].length > 10 && (

          <img
            src={inputImages[0]}
            alt=""
            className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          />
        )}
        <span className="text-[11px] font-medium flex-1 min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {compact ? t('chat.imagePrompt') : isBrief ? t('chat.midjourneyBrief') : t('chat.promptCard').replace(/nano banana 2|qwen edit|OpenAI Image 2/gi, modelLabel)}
        </span>
        <span className="text-[11px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>{open ? t('chat.collapse') : t('chat.expand')}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          {compact && <span className="text-[10px] text-white/40">{isBrief ? t('chat.midjourneyBrief') : modelLabel}</span>}
          {inputImages && inputImages.filter(img => img && img.length > 10).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {t('chat.inputImages')}{inputImages.length > 1 ? `（${inputImages.length}）` : ''}
              </span>
              <div className="flex gap-2 flex-wrap">
                {inputImages.filter(img => img && img.length > 10).map((img, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    { }
                    <img
                      src={img}
                      alt={`${t('chat.imageLabel')} ${i + 1}`}
                      className="rounded-lg object-cover"
                      style={{
                        width: inputImages.length > 1 ? 100 : 'auto',
                        height: inputImages.length > 1 ? 100 : 140,
                        maxHeight: 140,
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    />
                    {inputImages.length > 1 && (
                      <span className="text-[9px] text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
                        {inputImageLabels[i] ?? `${t('chat.imageLabel')} ${i + 1}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
            {prompt}
          </p>
        </div>
      )}
    </div>
  );
}
