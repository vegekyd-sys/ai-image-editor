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
  return (
    <div className="mt-3" style={{ maxWidth: 308 }} data-testid="generated-image-gallery">
      <div className="flex flex-col gap-3">
        {cards.map(({ snapshot, index, prompt }, position) => {
          const source = snapshot.imageUrl || snapshot.image;
          return (
            <div key={snapshot.id} className="min-w-0" data-snapshot-id={snapshot.id}>
              <button aria-label={`${t('image.generatedImage')} ${position + 1}`} aria-pressed={currentSnapshotIndex === index + 1}
                className="relative block w-full active:opacity-75 transition-opacity"
                onClick={event => onSelect(snapshot, event.currentTarget.getBoundingClientRect())}>
                <img src={source.startsWith('http') ? getThumbnailUrl(source, isPanel ? 680 : 1024, 75, 2000, 'contain') : source}
                  alt={`${t('image.generatedImage')} ${position + 1}`} className="w-full h-auto rounded-2xl"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-sm font-medium px-2 py-0.5 rounded-md">@{index + 1}</span>
              </button>
              {!shared && (prompt
                ? <ImagePromptCard prompt={prompt.prompt} inputImages={prompt.inputImages} editModel={prompt.model} isBrief={prompt.isBrief} />
                : <p className="mt-2 text-[11px] text-white/30">{t('chat.promptNotRecorded')}</p>)}
            </div>
          );
        })}
      </div>
      {shared && <ImagePromptCard prompt={shared.prompt} inputImages={shared.inputImages} editModel={shared.model} isBrief={shared.isBrief} />}
    </div>
  );
}
