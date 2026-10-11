import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentChatView from '@/components/AgentChatView';
import { LocaleProvider } from '@/lib/i18n';
import { Message, Snapshot } from '@/types';

vi.mock('@/lib/supabase/storage', () => ({
  getThumbnailUrl: (url: string, width: number) => `${url}?w=${width}`,
}));

describe('AgentChatView inline image preview', () => {
  it('keeps a multi-image user message inside a horizontally scrollable bubble', () => {
    const message: Message = {
      id: 'msg-multi-image',
      role: 'user',
      content: '一共 5 张图',
      editInputImages: Array.from({ length: 5 }, (_, index) => `https://example.com/${index}.jpg`),
      timestamp: Date.now(),
    };

    render(
      <LocaleProvider>
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={() => {}}
          mode="overlay"
        />
      </LocaleProvider>,
    );

    const firstImage = document.querySelector('img[src="https://example.com/0.jpg"]');
    expect(firstImage).toBeTruthy();
    expect(firstImage!.parentElement?.className).toContain('overflow-x-auto');
    expect(firstImage!.parentElement?.className).toContain('max-w-full');
  });

  it('anchors the attachment remove button over the thumbnail', async () => {
    render(
      <LocaleProvider>
        <AgentChatView
          messages={[]}
          isAgentActive={false}
          agentStatus=""
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={() => {}}
          draftAttachments={[{ id: 'draft-1', type: 'image', data: 'data:image/jpeg;base64,abc' }]}
          mode="overlay"
        />
      </LocaleProvider>,
    );

    const remove = await screen.findByRole('button', { name: 'Remove attachment' });
    await waitFor(() => expect(remove.style.position).toBe('absolute'));
    expect(remove.style.top).toBe('-4px');
    expect(remove.style.right).toBe('-4px');
    expect(remove.className).not.toContain('mkr-liquid-icon-button');
  });

  it('navigates generated message images back to GUI', () => {
    const onImageTap = vi.fn();
    const message: Message = {
      id: 'msg-image',
      role: 'assistant',
      content: '',
      image: 'https://example.com/generated.jpg',
      timestamp: Date.now(),
    };
    const snapshot: Snapshot = {
      id: 'snap-image',
      image: 'https://example.com/generated.jpg',
      imageUrl: 'https://example.com/generated.jpg',
      tips: [],
      messageId: 'msg-image',
    };

    render(
      <LocaleProvider>
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          currentImage="https://example.com/current.jpg"
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={onImageTap}
          snapshots={[snapshot]}
          mode="overlay"
        />
      </LocaleProvider>,
    );

    fireEvent.click(document.querySelector('[data-snapshot-id="snap-image"] button')!);

    expect(onImageTap).toHaveBeenCalledWith(
      'msg-image',
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      'https://example.com/generated.jpg',
      'snap-image',
    );
    expect(screen.queryByTestId('cui-inline-image-preview')).toBeNull();
  });

  it('opens the dev-style image ref popover from an @ image reference chip', () => {
    const onImageTap = vi.fn();
    const message: Message = {
      id: 'msg-text',
      role: 'assistant',
      content: 'Use `<<<image_1>>>` as the source.',
      timestamp: Date.now(),
    };
    const snapshot: Snapshot = {
      id: 'snap-image',
      image: 'https://example.com/generated.jpg',
      imageUrl: 'https://example.com/generated.jpg',
      tips: [],
      messageId: 'msg-image',
    };

    render(
      <LocaleProvider>
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          currentImage="https://example.com/current.jpg"
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={onImageTap}
          snapshots={[snapshot]}
          mode="overlay"
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByTestId('image-ref-chip-1'));

    const preview = screen.getByTestId('cui-inline-image-preview');
    expect(preview).toBeTruthy();
    expect(preview.querySelector('img')).toBeTruthy();
    expect(onImageTap).not.toHaveBeenCalled();
  });
});

it('shows every generated candidate and selects its exact snapshot rather than the first message image', () => {
  const onImageTap = vi.fn();
  const snapshots: Snapshot[] = Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index}`, image: `https://example.com/${index}.png`, imageUrl: `https://example.com/${index}.png`, messageId: 'mj-message', tips: [] }));
  render(<LocaleProvider><AgentChatView messages={[{ id: 'mj-message', role: 'assistant', content: '', image: snapshots[0].image, timestamp: Date.now() }]}
    snapshots={snapshots} currentSnapshotIndex={3} isAgentActive={false} agentStatus="" onSendMessage={() => {}} onBack={() => {}} onPipTap={() => {}} onImageTap={onImageTap} mode="overlay" /></LocaleProvider>);
  expect(document.querySelectorAll('[data-testid="generated-image-gallery"] img')).toHaveLength(4);
  expect(document.querySelectorAll('[data-testid="generated-image-gallery"] button')[2].getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(document.querySelectorAll('[data-testid="generated-image-gallery"] button')[2]);
  expect(onImageTap).toHaveBeenCalledWith('mj-message', expect.anything(), snapshots[2].imageUrl, 'candidate-2');
});
