import type { Message, Snapshot } from '@/types';

/** Prefer the accepted provider payload; old MJ cards contain only the user brief. */
export function resolveImagePromptCard(message: Message, snapshots: Snapshot[]) {
  const generation = snapshots.find(s => s.messageId === message.id && s.metadata?.midjourneyGeneration)
    ?.metadata?.midjourneyGeneration;
  if (generation) return { prompt: generation.prompt, model: 'mj-v8.2', isBrief: false };
  if (!message.editPrompt) return undefined;
  return { prompt: message.editPrompt, model: message.editModel, isBrief: message.editModel === 'mj-v8.2' };
}
