import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentChatView from '@/components/AgentChatView';
import { LocaleProvider } from '@/lib/i18n';

afterEach(cleanup);
describe('Retake chat selection context', () => {
  it('preserves typed instructions when the interval moves and sends the latest source range', () => {
    const send = vi.fn(), clear = vi.fn();
    const surface = (start: number, end: number, active = false) => <LocaleProvider><AgentChatView
      messages={[]} isAgentActive={active} agentStatus="" mode="panel"
      onSendMessage={send} onBack={vi.fn()} onPipTap={vi.fn()} onImageTap={vi.fn()}
      retakeContext={{mediaIndex: 3, start, end}} onClearRetake={clear}
    /></LocaleProvider>;
    const view = render(surface(5.8, 6.4));
    fireEvent.change(screen.getByTestId('chat-input'), {target: {value: '加入一个黄色角色'}});
    view.rerender(surface(7.2, 8.4, true));
    expect((screen.getByTestId('chat-input') as HTMLTextAreaElement).value).toBe('加入一个黄色角色');
    expect(screen.getByTestId('chat-retake-context').textContent).toContain('7.20');
    fireEvent.click(screen.getByRole('button', {name: /取消片段选择|Clear segment selection/}));
    expect(clear).toHaveBeenCalledOnce();
    clear.mockClear();
    view.rerender(surface(7.2, 8.4));
    fireEvent.click(screen.getByRole('button', {name: 'Send message'}));
    expect(send).toHaveBeenCalledWith('把 @3 的 7.20–8.40 秒换成： 加入一个黄色角色', undefined, undefined);
    expect(clear).toHaveBeenCalledOnce();
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]);
  });
  it('leaves ordinary chat untouched when no selection is active', () => {
    const send = vi.fn();
    render(<LocaleProvider><AgentChatView messages={[]} isAgentActive={false} agentStatus="" mode="panel"
      onSendMessage={send} onBack={vi.fn()} onPipTap={vi.fn()} onImageTap={vi.fn()} /></LocaleProvider>);
    fireEvent.change(screen.getByTestId('chat-input'), {target: {value: '介绍一下这段视频'}});
    fireEvent.click(screen.getByRole('button', {name: 'Send message'}));
    expect(send).toHaveBeenCalledWith('介绍一下这段视频', undefined, undefined);
  });
});
