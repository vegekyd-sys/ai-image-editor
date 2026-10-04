import type { Message } from '@/types';
import { extractInlineMediaNavigationId } from '@/lib/cui-video-url';

export function videoCompletionMessageId(snapshotId: string): string {
  return `video-completion-${snapshotId}`;
}

/** A restored notification and a live notification can have different legacy IDs. */
export function dedupeEditorMessages(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (!existing || (!existing.content && message.content)) byId.set(message.id, message);
  }
  const completedVideos = new Set<string>();
  return Array.from(byId.values())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .filter(message => {
      // Only standalone delivery notifications collapse. Ordinary conversation,
      // failed attempts and messages containing separate artifacts remain intact.
      if (message.role !== 'assistant' || !message.content.trimStart().startsWith('🎬')
        || message.image || message.images?.length || message.design || message.content.includes('```')) return true;
      const snapshotId = extractInlineMediaNavigationId(message.content);
      if (!snapshotId) return true;
      if (completedVideos.has(snapshotId)) return false;
      completedVideos.add(snapshotId);
      return true;
    });
}
