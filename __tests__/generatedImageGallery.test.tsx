import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GeneratedImageGallery from '@/components/GeneratedImageGallery';
import { getGeneratedImageCards, isImageGalleryEnabled, sharedImagePrompt } from '@/lib/editor/image-prompt-card';
import { restoreImageGenerationHistory } from '@/lib/editor/image-generation-history';
import type { Message, Snapshot } from '@/types';

vi.mock('@/lib/i18n', async () => {
  const { translate } = await import('@/lib/locales');
  return { useLocale: () => ({ t: (key: Parameters<typeof translate>[1]) => translate('zh', key) }) };
});
afterEach(cleanup);
const message: Message = { id: 'turn', role: 'assistant', content: '', timestamp: 1, image: '/third.png', editPrompt: 'last prompt' };
const snapshot = (id: string, prompt?: string, generationId = id): Snapshot => ({
  id, image: `/${id}.png`, messageId: 'turn', tips: [],
  metadata: prompt ? { imageGeneration: { id: generationId, prompt, model: 'gpt-image-2.5-flare' } } : undefined,
});

describe('model-independent generated image gallery', () => {
  it('renders three ordinary model images with independently expandable matching prompts and exact selection', () => {
    const snapshots = [snapshot('reference'), ...['first', 'second', 'third'].map(id => snapshot(id, `${id} prompt`))];
    snapshots[0].messageId = 'upload';
    const onSelect = vi.fn();
    const cards = getGeneratedImageCards(message, snapshots);
    const view = render(<GeneratedImageGallery cards={cards} currentSnapshotIndex={3} onSelect={onSelect} />);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    const second = view.container.querySelector('[data-snapshot-id="second"]')! as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: /^Prompt/ }));
    expect(within(second).getByText('second prompt')).toBeTruthy();
    expect(screen.queryByText('first prompt')).toBeNull();
    const imageButton = within(second).getByRole('button', { name: '生成图片 2' });
    expect(imageButton.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(imageButton);
    expect(onSelect.mock.calls[0][0].id).toBe('second');
    expect(within(second).getByText('@3')).toBeTruthy();
  });
  it('shares one prompt for a batch but keeps distinct calls separate even with identical text', () => {
    const batch = getGeneratedImageCards(message, ['a', 'b', 'c', 'd'].map(id => snapshot(id, 'one prompt', 'accepted-task')));
    expect(sharedImagePrompt(batch)?.prompt).toBe('one prompt');
    const view = render(<GeneratedImageGallery cards={batch} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /发给 GPT/ })).toHaveLength(1);
    view.unmount();
    expect(sharedImagePrompt(getGeneratedImageCards(message, [snapshot('a', 'same'), snapshot('b', 'same')]))).toBeUndefined();
  });
  it('never copies the last legacy prompt onto earlier images and excludes design/video previews', () => {
    const cards = getGeneratedImageCards(message, [snapshot('first'), { ...snapshot('video'), type: 'video' }, { ...snapshot('design'), designPath: 'design.json' }, snapshot('third')]);
    expect(cards).toHaveLength(2);
    expect(cards[0].prompt).toBeUndefined();
    expect(cards[1].prompt?.prompt).toBe('last prompt');
  });
  it('leaves production off by default and supports classic comparison', () => {
    expect(isImageGalleryEnabled(false, false)).toBe(false);
    expect(isImageGalleryEnabled(true, false)).toBe(true);
    expect(isImageGalleryEnabled(true, false, 'classic')).toBe(false);
    expect(isImageGalleryEnabled(false, true)).toBe(true);
  });
});

describe('historical per-image prompt recovery', () => {
  it('restores three sequential calls in one message after reload, in event sequence order', () => {
    const events = ['first', 'second', 'third'].flatMap((id, index) => [
      { type: 'tool_call', run_id: 'run', seq: index * 2, data: { tool: 'generate_image', input: { editPrompt: `${id} prompt`, model: 'gemini' } } },
      { type: 'image', run_id: 'run', seq: index * 2 + 1, data: { snapshotId: id, usedModel: 'gpt-image-2.5-flare' } },
    ]).reverse();
    const restored = restoreImageGenerationHistory(['first', 'second', 'third'].map(id => snapshot(id)), events);
    expect(getGeneratedImageCards(message, restored).map(card => card.prompt?.prompt)).toEqual(['first prompt', 'second prompt', 'third prompt']);
    expect(restored[0].metadata?.imageGeneration?.model).toBe('gpt-image-2.5-flare');
  });
  it('keeps runs isolated, unrelated tool images unassigned, and accepted MJ prompts intact', () => {
    const mj = { ...snapshot('mj'), metadata: { midjourneyGeneration: { prompt: 'actual English', taskId: 'mj-task', quality: 'standard' as const, speed: 'fast' as const } } };
    const restored = restoreImageGenerationHistory([snapshot('a'), snapshot('unrelated'), mj], [
      { type: 'tool_call', run_id: 'r1', seq: 1, data: { tool: 'generate_image', input: { editPrompt: 'first' } } },
      { type: 'tool_call', run_id: 'r2', seq: 1, data: { tool: 'generate_image', input: { editPrompt: '中文', model: 'mj-v8.2' } } },
      { type: 'image', run_id: 'r1', seq: 2, data: { snapshotId: 'a' } },
      { type: 'image', run_id: 'r2', seq: 2, data: { snapshotId: 'mj', usedModel: 'mj-v8.2' } },
      { type: 'tool_call', run_id: 'r1', seq: 3, data: { tool: 'materialize_media' } },
      { type: 'image', run_id: 'r1', seq: 4, data: { snapshotId: 'unrelated' } },
    ]);
    expect(restored[0].metadata?.imageGeneration?.prompt).toBe('first');
    expect(restored[1].metadata?.imageGeneration).toBeUndefined();
    expect(restored[2]).toEqual(mj);
  });
});
