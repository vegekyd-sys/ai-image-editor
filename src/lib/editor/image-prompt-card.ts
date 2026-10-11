import type { Message, Snapshot } from '@/types';

export interface ImagePromptCardData {
  prompt: string;
  model?: string;
  isBrief: boolean;
  generationId?: string;
  inputImages?: string[];
}

export function snapshotImagePrompt(snapshot: Snapshot): ImagePromptCardData | undefined {
  const generation = snapshot.metadata?.imageGeneration;
  if (generation) return { prompt: generation.prompt, model: generation.model, isBrief: generation.promptKind === 'brief', generationId: generation.id, inputImages: generation.inputImages };
  const mj = snapshot.metadata?.midjourneyGeneration;
  if (mj) return { prompt: mj.prompt, model: 'mj-v8.2', isBrief: false, generationId: mj.taskId };
}

export function getGeneratedImageCards(message: Message, snapshots: Snapshot[]) {
  const photos = snapshots.map((snapshot, index) => ({ snapshot, index }))
    .filter(({ snapshot }) => snapshot.messageId === message.id && !snapshot.design && !snapshot.designPath && !snapshot.videoMeta && snapshot.type !== 'video' && Boolean(snapshot.imageUrl || snapshot.image));
  return photos.map((entry, index) => ({ ...entry,
    // A legacy turn only kept its LAST prompt. Never assign it to every earlier image.
    prompt: snapshotImagePrompt(entry.snapshot) ?? (index === photos.length - 1 && message.editPrompt
      ? { prompt: message.editPrompt, model: message.editModel, isBrief: message.editModel === 'mj-v8.2', inputImages: message.editInputImages }
      : undefined),
  }));
}

export function sharedImagePrompt(cards: ReturnType<typeof getGeneratedImageCards>) {
  const first = cards[0]?.prompt;
  return first?.generationId && cards.every(card => card.prompt?.generationId === first.generationId && card.prompt?.prompt === first.prompt && card.prompt?.model === first.model)
    ? first : undefined;
}

/** Single-image / classic presentation uses the last image's own prompt. */
export function resolveImagePromptCard(message: Message, snapshots: Snapshot[]) {
  const persisted = getGeneratedImageCards(message, snapshots).at(-1)?.prompt;
  if (persisted) return persisted;
  if (!message.editPrompt) return undefined;
  return { prompt: message.editPrompt, model: message.editModel, isBrief: message.editModel === 'mj-v8.2', inputImages: message.editInputImages };
}

/** Accepted vertical image presentation is default; classic remains a comparison option. */
export function isImageGalleryEnabled(mode?: string | null) {
  return mode !== 'classic';
}
