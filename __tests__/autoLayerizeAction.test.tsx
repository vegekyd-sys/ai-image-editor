import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentStatusBar from '@/components/AgentStatusBar';
import { LocaleProvider } from '@/lib/i18n';
afterEach(cleanup);
it('exposes a contextual action that sends once without opening chat, and disables it while active',()=>{
  const action=vi.fn(),chat=vi.fn();
  const ui=(active:boolean)=><LocaleProvider><AgentStatusBar statusText="Ready" isActive={active} onOpenChat={chat} onAutoLayerize={action}/></LocaleProvider>;
  const view=render(ui(false));fireEvent.click(screen.getByTestId('auto-layerize'));
  expect(action).toHaveBeenCalledOnce();expect(chat).not.toHaveBeenCalled();
  view.rerender(ui(true));fireEvent.click(screen.getByTestId('auto-layerize'));expect(action).toHaveBeenCalledOnce();
  view.rerender(<LocaleProvider><AgentStatusBar statusText="Ready" isActive={false} onOpenChat={chat}/></LocaleProvider>);
  expect(screen.queryByTestId('auto-layerize')).toBeNull();
});
