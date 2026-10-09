import { describe, expect, it } from 'vitest';
import type { Message, Snapshot } from '@/types';
import { resolveImagePromptCard } from '@/lib/editor/image-prompt-card';

const message: Message = { id: 'turn', role: 'assistant', content: '', timestamp: 1, editPrompt: '人物占主要地位', editModel: 'mj-v8.2' };
describe('submitted Midjourney prompt transparency', () => {
  it('uses the persisted submitted prompt after reload even without a live tool call', () => {
    const snapshot = { id: 'candidate', messageId: 'turn', metadata: { midjourneyGeneration: { prompt: 'Frame-filling portrait on Mars --s 250', taskId: 'accepted-task', quality: 'standard', speed: 'fast' } } } as Snapshot;
    expect(resolveImagePromptCard({ ...message, editPrompt: undefined, editModel: undefined }, [snapshot])).toEqual({ prompt: 'Frame-filling portrait on Mars --s 250', model: 'mj-v8.2', isBrief: false });
    expect(resolveImagePromptCard({ ...message, id: 'other' }, [snapshot])?.isBrief).toBe(true);
  });
  it('labels legacy Chinese MJ input as a brief and retains ordinary image prompt cards', () => {
    expect(resolveImagePromptCard(message, [])).toEqual({ prompt: message.editPrompt, model: 'mj-v8.2', isBrief: true });
    expect(resolveImagePromptCard({ ...message, editModel: 'gpt-image-2.5-flare' }, [])?.isBrief).toBe(false);
    expect(resolveImagePromptCard({ ...message, editPrompt: undefined }, [])).toBeUndefined();
  });
});
