import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthProvider from '@/components/AuthProvider';

const mocks = vi.hoisted(() => ({
  isMakaronIOSApp: vi.fn(() => true),
  readNativeJSONCache: vi.fn(() => null),
  writeNativeJSONCache: vi.fn(),
  removeNativeJSONCache: vi.fn(),
  warmNativeJSONCache: vi.fn(() => Promise.resolve()),
  warmProjectsListCache: vi.fn(() => Promise.resolve()),
  clearUserCache: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: mocks.isMakaronIOSApp,
}));

vi.mock('@/lib/native-app-cache', () => ({
  readNativeJSONCache: mocks.readNativeJSONCache,
  writeNativeJSONCache: mocks.writeNativeJSONCache,
  removeNativeJSONCache: mocks.removeNativeJSONCache,
  warmNativeJSONCache: mocks.warmNativeJSONCache,
}));

vi.mock('@/lib/projects-list-warm', () => ({
  warmProjectsListCache: mocks.warmProjectsListCache,
}));

vi.mock('@/lib/imageCache', () => ({
  clearUserCache: mocks.clearUserCache,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      getUser: mocks.getUser,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
    },
  }),
}));

describe('iOS native auth cache warmup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 0 });
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 't@example.com' } } },
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 't@example.com' } },
      error: null,
    });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('warms app-like iOS user caches as soon as the session is restored', async () => {
    render(
      <AuthProvider>
        <div>ready</div>
      </AuthProvider>
    );

    expect(screen.getByText('ready')).toBeTruthy();

    await waitFor(() => {
      expect(mocks.warmProjectsListCache).toHaveBeenCalledWith('user-1');
    });

    expect(mocks.writeNativeJSONCache).toHaveBeenCalledWith('/auth/user', { id: 'user-1', email: 't@example.com' });
    expect(mocks.warmNativeJSONCache).toHaveBeenCalledWith('/api/billing/credits');
    expect(mocks.warmNativeJSONCache).toHaveBeenCalledWith('/api/billing/dashboard');
    expect(mocks.warmNativeJSONCache).toHaveBeenCalledWith('/api/skills');
    expect(mocks.warmNativeJSONCache).toHaveBeenCalledWith('/api/home-skills');
  });
});
