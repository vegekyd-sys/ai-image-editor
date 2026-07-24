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

    fireEvent.click(screen.getByAltText('Generated'));

    expect(onImageTap).toHaveBeenCalledWith(
      'msg-image',
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      'https://example.com/generated.jpg',
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
