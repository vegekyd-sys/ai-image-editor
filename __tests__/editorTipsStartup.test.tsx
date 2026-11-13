import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  compress: vi.fn(),
  reconnect: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/hooks/useAgentRun', () => ({ useAgentRun: () => ({ activeRunId: null, reconnect: mocks.reconnect, disconnect: mocks.disconnect }) }));
vi.mock('@/lib/imageUtils', () => ({ compressBase64Image: mocks.compress, compressImageFile: vi.fn(), isHeicFile: () => false }));
vi.mock('@/lib/agentStream', () => ({ streamAgent: vi.fn(async () => {}) }));
vi.mock('@/lib/babel-status', () => ({ getBabelStatus: () => ({ status: 'ready' }), subscribeBabelStatus: () => () => {} }));
vi.mock('@/lib/imageCache', () => ({ cacheImage: vi.fn(), updateCachedTips: vi.fn() }));
vi.mock('@/components/ImageCanvas', () => ({ default: () => <div data-testid="image-canvas" /> }));
vi.mock('@/components/AgentChatView', () => ({ default: () => null }));
vi.mock('@/components/AgentStatusBar', () => ({ default: () => null }));
vi.mock('@/components/AnnotationToolbar', () => ({ default: () => null }));
vi.mock('@/components/CreditPopup', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/SaveMediaDialog', () => ({ default: () => null }));
vi.mock('@/components/VideoResultCard', () => ({ default: () => null }));
import Editor from '@/components/Editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done });
  return { promise, resolve };
}
const source = 'data:image/png;base64,aW1hZ2U=';
const pendingImages = [source];

beforeEach(() => {
  mocks.compress.mockReset().mockResolvedValue(source);
  localStorage.clear();
  localStorage.setItem('mkr_auto_tips', 'off');
  localStorage.setItem('locale', 'zh');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ balance: 100, skills: [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() });

function mount(onSaveSnapshot = vi.fn()) {
  return render(<LocaleProvider initialLocale="zh"><Editor projectId="startup-project" pendingImages={pendingImages} onSaveSnapshot={onSaveSnapshot} /></LocaleProvider>);
}

describe('new project Tips startup', () => {
  it('shows loading throughout persistence and compression before the Tips request starts', async () => {
    const saved = deferred<void>();
    const compressed = deferred<string>();
    mocks.compress.mockReturnValue(compressed.promise);
    const save = vi.fn(() => saved.promise);
    mount(save);
    await waitFor(() => expect(screen.getByTestId('editor').getAttribute('data-snapshot-count')).toBe('1'));
    expect(screen.getByTestId('editor').getAttribute('data-tips-status')).toBe('loading');
    expect(screen.queryByRole('button', { name: '重新加载修图建议' })).toBeNull();
    expect(screen.getByTestId('tips-bar').querySelector('.mkr-liquid-placeholder')).toBeTruthy();
    await act(async () => { saved.resolve(); await saved.promise });
    await waitFor(() => expect(mocks.compress).toHaveBeenCalledOnce());
    expect(screen.getByTestId('editor').getAttribute('data-tips-status')).toBe('loading');
    expect(screen.queryByRole('button', { name: '重新加载修图建议' })).toBeNull();
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/tips');
    expect(requests).toHaveLength(0);
  });

  it('keeps the reload action after a completed empty request, and enters loading immediately on retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tips'
      ? new Response('data: [BLOCKED]\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json({ balance: 100, skills: [] })));
    mount();
    const reload = await screen.findByRole('button', { name: '重新加载修图建议' });
    const retryCompression = deferred<string>();
    mocks.compress.mockReturnValue(retryCompression.promise);
    fireEvent.click(reload);
    expect(screen.getByTestId('editor').getAttribute('data-tips-status')).toBe('loading');
    expect(screen.queryByRole('button', { name: '重新加载修图建议' })).toBeNull();
    warn.mockRestore();
  });

  it('starts an existing empty image snapshot in loading before its auto-fetch effect', async () => {
    const compressed = deferred<string>();
    mocks.compress.mockReturnValue(compressed.promise);
    render(<LocaleProvider initialLocale="zh"><Editor projectId="existing-project" initialSnapshots={[
      { id: 'existing-image', image: source, tips: [], messageId: '' },
    ]} /></LocaleProvider>);
    expect(screen.getByTestId('editor').getAttribute('data-tips-status')).toBe('loading');
    expect(screen.queryByRole('button', { name: '重新加载修图建议' })).toBeNull();
  });
});
