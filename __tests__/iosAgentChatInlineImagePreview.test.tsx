import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AgentChatView from '@/components/AgentChatView';
import { LocaleProvider } from '@/lib/i18n';
import { Message, Snapshot } from '@/types';

vi.mock('@/lib/supabase/storage', () => ({
  getThumbnailUrl: (url: string, width: number) => `${url}?w=${width}`,
}));

describe('AgentChatView inline image preview', () => {
  it('opens a square CUI preview instead of navigating to GUI', () => {
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

    expect(screen.getByTestId('cui-inline-image-preview')).toBeTruthy();
    expect(onImageTap).not.toHaveBeenCalled();
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
