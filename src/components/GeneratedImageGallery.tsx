'use client';

import type { Snapshot } from '@/types';
import { useLocale } from '@/lib/i18n';
import { getThumbnailUrl } from '@/lib/supabase/storage';
import { sharedImagePrompt, type getGeneratedImageCards } from '@/lib/editor/image-prompt-card';
import ImagePromptCard from '@/components/ImagePromptCard';

export default function GeneratedImageGallery({ cards, currentSnapshotIndex, isPanel, onSelect }: {
  cards: ReturnType<typeof getGeneratedImageCards>;
  currentSnapshotIndex?: number;
  isPanel?: boolean;
  onSelect: (snapshot: Snapshot, rect: DOMRect) => void;
}) {
  const { t } = useLocale();
  const shared = sharedImagePrompt(cards);
  const multiple = cards.length > 1;
  return (
    <div className="mt-3" data-testid="generated-image-gallery">
      {multiple && <p className="text-sm text-white/60 mb-2">{t('image.generatedImages')} · {cards.length}</p>}
      <div className={multiple ? 'grid grid-cols-2 gap-2 items-start' : ''} style={multiple ? undefined : { maxWidth: 308 }}>
        {cards.map(({ snapshot, index, prompt }, position) => {
          const source = snapshot.imageUrl || snapshot.image;
          return (
            <div key={snapshot.id} className="min-w-0" data-snapshot-id={snapshot.id}>
              <button aria-label={`${t('image.generatedImage')} ${position + 1}`} aria-pressed={currentSnapshotIndex === index + 1}
                className="relative block w-full overflow-hidden rounded-xl border border-white/10 active:opacity-75"
                onClick={event => onSelect(snapshot, event.currentTarget.getBoundingClientRect())}>
                <img src={source.startsWith('http') ? getThumbnailUrl(source, isPanel ? (multiple ? 340 : 680) : (multiple ? 512 : 1024), 75, 2000, 'contain') : source}
                  alt={`${t('image.generatedImage')} ${position + 1}`} className="w-full h-auto" />
                <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">@{index + 1}</span>
              </button>
              {!shared && (prompt
                ? <ImagePromptCard prompt={prompt.prompt} inputImages={prompt.inputImages} editModel={prompt.model} isBrief={prompt.isBrief} compact={multiple} />
                : <p className="mt-2 text-[11px] text-white/30">{t('chat.promptNotRecorded')}</p>)}
            </div>
          );
        })}
      </div>
      {shared && <ImagePromptCard prompt={shared.prompt} inputImages={shared.inputImages} editModel={shared.model} isBrief={shared.isBrief} />}
      {multiple && <p className="text-xs text-white/40 mt-2">{t('image.chooseCandidate')}</p>}
    </div>
  );
}
