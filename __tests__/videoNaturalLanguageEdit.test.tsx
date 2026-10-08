import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgentChatView from '@/components/AgentChatView';
import { LocaleProvider } from '@/lib/i18n';

afterEach(cleanup);

describe('video editing without a GUI selection', () => {
  it.each([
    '把 @1 的 18–21 秒切成多机位，其余不变',
    '把 @1 的前半段改成图片分层的感觉',
    '把 @1 中机器人起跳那段改成侧面近景',
    '删除 @1 的最后三秒',
    '给 @1 加中文字幕',
  ])('sends the natural-language instruction directly to the Agent: %s', instruction => {
    const send = vi.fn();
    render(<LocaleProvider><AgentChatView messages={[]} isAgentActive={false} agentStatus="" mode="panel"
      onSendMessage={send} onBack={vi.fn()} onPipTap={vi.fn()} onImageTap={vi.fn()} /></LocaleProvider>);
    expect(screen.queryByTestId('chat-retake-context')).toBeNull();
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: instruction } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(send).toHaveBeenCalledWith(instruction, undefined, undefined);
  });
});
