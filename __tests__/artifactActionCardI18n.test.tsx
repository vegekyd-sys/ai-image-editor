import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentChatView from '@/components/AgentChatView';
import { buildVideoFailureActions, serializeCompletionActions } from '@/lib/artifact-actions';
import { LocaleProvider } from '@/lib/i18n';
import type { Message } from '@/types';

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

describe('AgentChatView video failure action i18n', () => {
  it('renders English actions and passes the English prompt through on click', () => {
    installDomStubs();
    const onArtifactAction = vi.fn();
    const actions = buildVideoFailureActions({
      error: 'Blocked by safety policy',
      prompt: 'A rooftop chase',
      duration: 15,
      model: 'seedance-fast',
    }, 'en');
    const message: Message = {
      id: 'video-failed',
      role: 'assistant',
      content: `Video generation failed.\n${serializeCompletionActions(actions)}`,
      timestamp: Date.now(),
    };

    render(
      <LocaleProvider initialLocale="en">
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={() => {}}
          onArtifactAction={onArtifactAction}
          mode="panel"
        />
      </LocaleProvider>,
    );

    expect(screen.getByText('Next steps')).toBeTruthy();
    expect(screen.getByText('Make safer & retry')).toBeTruthy();
    expect(screen.getByText('Review the cause')).toBeTruthy();
    expect(screen.queryByText('改安全点重试')).toBeNull();
    expect(screen.queryByText('先看原因')).toBeNull();

    const continueButtons = screen.getAllByRole('button', { name: 'Continue' });
    fireEvent.click(continueButtons[0]);

    expect(onArtifactAction).toHaveBeenCalledTimes(1);
    const selected = onArtifactAction.mock.calls[0][0];
    expect(selected.label).toBe('Make safer & retry');
    expect(selected.prompt).toContain('The last video generation failed.');
    expect(JSON.stringify(selected)).not.toMatch(/[\u3400-\u9fff]/);
  });

  it('renders Japanese actions and passes the Japanese prompt through on click', () => {
    installDomStubs();
    window.localStorage.setItem('locale', 'ja');
    const onArtifactAction = vi.fn();
    const actions = buildVideoFailureActions({
      error: 'Blocked by safety policy',
      prompt: '15秒の屋上チェイス',
      duration: 15,
      model: 'seedance-fast',
    }, 'ja');
    const message: Message = {
      id: 'video-failed-ja',
      role: 'assistant',
      content: `安全ポリシーにより動画を生成できませんでした。\n${serializeCompletionActions(actions)}`,
      timestamp: Date.now(),
    };

    render(
      <LocaleProvider initialLocale="ja">
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={() => {}}
          onArtifactAction={onArtifactAction}
          mode="panel"
        />
      </LocaleProvider>,
    );

    expect(screen.getByText('次のステップ')).toBeTruthy();
    expect(screen.getByText('安全に直して再試行')).toBeTruthy();
    expect(screen.getByText('原因を確認')).toBeTruthy();
    expect(screen.queryByText('改安全点重试')).toBeNull();
    expect(screen.queryByText('先看原因')).toBeNull();

    const continueButtons = screen.getAllByRole('button', { name: '続ける' });
    fireEvent.click(continueButtons[0]);

    expect(onArtifactAction).toHaveBeenCalledTimes(1);
    const selected = onArtifactAction.mock.calls[0][0];
    expect(selected.label).toBe('安全に直して再試行');
    expect(selected.prompt).toContain('先ほどの動画生成に失敗しました。');
    expect(selected.prompt).toContain('15秒の屋上チェイス');
    expect(selected.prompt).not.toContain('刚才这个视频生成失败了');
    window.localStorage.removeItem('locale');
  });

  it('renders the Seedance 2.5 Mature Mode recovery only inside the failure card', () => {
    installDomStubs();
    const onArtifactAction = vi.fn();
    const actions = buildVideoFailureActions({
      error: 'Blocked by content safety policy',
      prompt: 'A fashion film by the pool',
      duration: 30,
      model: 'seedance-2.5',
      contentFilter: true,
    }, 'en');
    const message: Message = {
      id: 'seedance-25-video-failed',
      role: 'assistant',
      content: `Video generation failed.\n${serializeCompletionActions(actions)}`,
      timestamp: Date.now(),
    };

    render(
      <LocaleProvider initialLocale="en">
        <AgentChatView
          messages={[message]}
          isAgentActive={false}
          agentStatus=""
          onSendMessage={() => {}}
          onBack={() => {}}
          onPipTap={() => {}}
          onImageTap={() => {}}
          onArtifactAction={onArtifactAction}
          mode="panel"
        />
      </LocaleProvider>,
    );

    expect(screen.getByText('Retry with Mature Mode')).toBeTruthy();
    expect(screen.getByText(/\+10%/)).toBeTruthy();
    expect(screen.queryByText('Make safer & retry')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Continue' })[0]);
    expect(onArtifactAction).toHaveBeenCalledTimes(1);
    expect(onArtifactAction.mock.calls[0][0].prompt).toContain('content_filter: false');
  });
});
