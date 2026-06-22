import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentChatView from '@/components/AgentChatView';
import { LocaleProvider } from '@/lib/i18n';
import zh from '@/lib/locales/zh';
import en from '@/lib/locales/en';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function installDomStubs() {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub });
}

describe('video frame edit GUI to CUI draft flow', () => {
  it('places the captured frame in the composer, focuses the default prompt, and does not send before click', async () => {
    installDomStubs();
    const onSendMessage = vi.fn();
    const frame = 'data:image/jpeg;base64,ZmFrZS1mcmFtZQ==';
    const prompt = zh['video.frameEditDraftPrompt'](2, '0:09');

    render(
      <LocaleProvider>
        <AgentChatView
          messages={[]}
          isAgentActive={false}
          agentStatus=""
          currentImage={frame}
          onSendMessage={onSendMessage}
          onBack={vi.fn()}
          onPipTap={vi.fn()}
          onImageTap={vi.fn()}
          draftText={prompt}
          draftAttachments={[{ id: 'frame-edit-video-1-9000', type: 'image', data: frame }]}
        />
      </LocaleProvider>,
    );

    const input = await screen.findByTestId('chat-input') as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe('@2 0:09 从这一帧开始修改这个视频，'));
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(input.value.length);
    expect(screen.getByTestId('chat-attachment-image').getAttribute('data-attachment-status')).toBe('ready');
    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: `${prompt}把车轮修正` } });
    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith(
      '@2 0:09 从这一帧开始修改这个视频，把车轮修正',
      [frame],
      undefined,
    );
  });

  it('keeps the default frame-edit prompt localized', () => {
    expect(zh['video.frameEditDraftPrompt'](3, '0:09')).toBe('@3 0:09 从这一帧开始修改这个视频，');
    expect(en['video.frameEditDraftPrompt'](3, '0:09')).toBe('@3 0:09 edit this video starting from this frame, ');
  });

  it('keeps frame-anchored video edits routed to analyze_video without auto-generation', () => {
    const editor = read('src/components/Editor.tsx');
    const canvas = read('src/components/ImageCanvas.tsx');
    const context = read('src/lib/agent-context.ts');
    const agent = read('src/lib/prompts/agent.md');

    expect(editor).toContain("t('video.frameEditDraftPrompt', mediaIndex, timeLabel)");
    expect(editor).toContain("setCuiDraftAttachments([{ id: attachmentId, type: 'image', data: dataUrl, thumbnail: dataUrl }])");
    expect(editor).not.toContain("role: 'assistant',\\n      content: t('video.frameCaptured'");
    expect(canvas).toContain('data-testid="video-frame-capture-feedback"');
    expect(canvas).toContain('window.setTimeout(() => {');
    expect(context).toContain('[Frame-anchored video edit]');
    expect(context).toContain('analyze_video({ mode: "locate_frame" })');
    expect(context).toContain('do not call generate_animation until the user explicitly confirms generation');
    expect(agent).toContain('For screenshot/frame-based local video repair');
    expect(agent).toContain('locate the screenshot with `analyze_video({ mode: "locate_frame" })` first');
  });
});
