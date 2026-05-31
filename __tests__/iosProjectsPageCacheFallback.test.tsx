import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectsPage from '@/app/projects/page';
import { cacheProjectsList, clearUserCache } from '@/lib/imageCache';

const router = {
  push: vi.fn(),
  replace: vi.fn(),
};

const authState = vi.hoisted(() => ({
  current: {
    user: null as { id: string } | null,
    loading: true,
  },
}));

const supabaseState = vi.hoisted(() => ({
  projectRowsPromise: null as Promise<{ data: Array<{ id: string; title: string; cover_url: string | null; updated_at: string; created_at: string }> | null; error: unknown }> | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.current.user,
    loading: authState.current.loading,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        delete: vi.fn(() => query),
        update: vi.fn(() => query),
        then: (
          resolve: (value: { data: unknown[] | null; error: unknown }) => void,
          reject: (reason?: unknown) => void,
        ) => {
          const result = table === 'projects'
            ? (supabaseState.projectRowsPromise ?? Promise.resolve({ data: [], error: null }))
            : Promise.resolve({ data: [], error: null });
          return result.then(resolve, reject);
        },
      };
      return query;
    },
  }),
}));

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => false,
}));

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({
    locale: 'zh',
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/TopBar', () => ({
  default: () => <div data-testid="topbar" />,
}));

vi.mock('@/components/RollingTagline', () => ({
  default: () => <div>one man creative studio</div>,
}));

vi.mock('@/components/MakaronLogo', () => ({
  MakaronSpark: () => <span>*</span>,
}));

vi.mock('@/components/CreateInputBox', () => ({
  default: () => <div data-testid="create-input" />,
}));

vi.mock('@/components/ProjectEditorContainer', () => ({
  default: ({ projectId, onBack, isInlineActive }: { projectId: string; onBack?: () => void; isInlineActive?: boolean }) => (
    <div data-testid="project-editor" data-inline-active={String(isInlineActive)}>
      <span>{projectId}</span>
      <button type="button" data-testid="project-editor-back" onClick={onBack}>Back</button>
    </div>
  ),
}));

describe('iOS projects page cache fallback', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects');
    document.documentElement.classList.add('makaron-ios-app');
    authState.current = { user: null, loading: true };
    router.push.mockClear();
    router.replace.mockClear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ skills: [] }),
    })));
    clearUserCache();
    supabaseState.projectRowsPromise = null;
    cacheProjectsList('user-1', [{
      id: 'project-1',
      title: 'Cached Project',
      cover_url: null,
      updated_at: '2026-05-31T00:00:00.000Z',
      created_at: '2026-05-31T00:00:00.000Z',
      snapshots: [{ id: 'snap-1', image_url: 'https://cdn.makaron.app/snap.jpg', sort_order: 0 }],
    }]);
  });

  afterEach(() => {
    document.documentElement.classList.remove('makaron-ios-app');
    clearUserCache();
    vi.unstubAllGlobals();
  });

  it('renders cached projects instead of the full-screen auth spinner while auth is pending', async () => {
    render(<ProjectsPage />);

    expect(await screen.findByText('Cached Project')).toBeTruthy();
    expect(screen.queryByText('No projects yet')).toBeNull();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('opens and closes the iOS inline editor without changing route or page freeze', async () => {
    render(<ProjectsPage />);

    const title = await screen.findByText('Cached Project');
    const card = title.closest('[role="link"]');
    expect(card).toBeTruthy();

    fireEvent.click(card!);

    expect(await screen.findByTestId('project-editor')).toBeTruthy();
    expect(window.location.pathname).toBe('/projects');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/projects');

    const page = document.querySelector('.makaron-projects-page') as HTMLElement | null;
    expect(page).toBeTruthy();
    expect(page?.style.position).not.toBe('fixed');
    expect(page?.style.top).toBe('');
    expect(document.querySelector('[data-makaron-ios-project-freeze-spacer="true"]')).toBeNull();

    fireEvent.click(screen.getByTestId('project-editor-back'));

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
      expect(overlay?.style.visibility).toBe('hidden');
    });

    expect(window.location.pathname).toBe('/projects');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/projects');
    expect(document.querySelector('[data-makaron-ios-project-freeze-spacer="true"]')).toBeNull();
    expect(screen.getByText('Cached Project')).toBeTruthy();

    const retainedOverlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
    expect(retainedOverlay).toBeTruthy();
    expect(retainedOverlay?.style.visibility).toBe('hidden');
    expect(screen.getByTestId('project-editor').getAttribute('data-inline-active')).toBe('false');
  });

  it('can reopen the retained inline editor and still close with the top back button', async () => {
    render(<ProjectsPage />);

    const title = await screen.findByText('Cached Project');
    const card = title.closest('[role="link"]');
    expect(card).toBeTruthy();

    fireEvent.click(card!);
    expect((await screen.findByTestId('project-editor')).getAttribute('data-inline-active')).toBe('true');
    fireEvent.click(screen.getByTestId('project-editor-back'));

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.style.visibility).toBe('hidden');
    });

    fireEvent.click(card!);

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.style.visibility).toBe('visible');
    });
    expect(screen.getByTestId('project-editor').getAttribute('data-inline-active')).toBe('true');

    fireEvent.click(screen.getByTestId('project-editor-back'));

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.style.visibility).toBe('hidden');
    });
    expect(screen.getByTestId('project-editor').getAttribute('data-inline-active')).toBe('false');
  });

  it('ignores duplicate back requests while the iOS inline editor is already closing', async () => {
    render(<ProjectsPage />);

    const title = await screen.findByText('Cached Project');
    const card = title.closest('[role="link"]');
    expect(card).toBeTruthy();

    fireEvent.click(card!);
    expect(await screen.findByTestId('project-editor')).toBeTruthy();

    const back = screen.getByTestId('project-editor-back');
    fireEvent.click(back);
    fireEvent.click(back);

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.style.visibility).toBe('hidden');
    });

    expect(window.location.pathname).toBe('/projects');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/projects');
    expect(router.replace).not.toHaveBeenCalledWith('/login');
    expect(screen.getByText('Cached Project')).toBeTruthy();
    expect(screen.getByTestId('project-editor')).toBeTruthy();
  });

  it('keeps the cached projects page visible during a brief iOS auth gap after returning from editor', async () => {
    const { rerender } = render(<ProjectsPage />);

    const title = await screen.findByText('Cached Project');
    const card = title.closest('[role="link"]');
    expect(card).toBeTruthy();

    fireEvent.click(card!);
    expect(await screen.findByTestId('project-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('project-editor-back'));

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.style.visibility).toBe('hidden');
    });

    authState.current = { user: null, loading: false };
    rerender(<ProjectsPage />);

    expect(screen.getByText('Cached Project')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('keeps cached iOS projects visible when auth resolves empty instead of flashing to login/loading', async () => {
    const { rerender } = render(<ProjectsPage />);

    expect(await screen.findByText('Cached Project')).toBeTruthy();

    authState.current = { user: null, loading: false };
    rerender(<ProjectsPage />);

    expect(screen.getByText('Cached Project')).toBeTruthy();
    expect(screen.queryByText('No projects yet')).toBeNull();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('discards an in-flight iOS projects refresh when detail navigation changes before it resolves', async () => {
    let resolveProjects!: (value: { data: Array<{ id: string; title: string; cover_url: string | null; updated_at: string; created_at: string }>; error: null }) => void;
    supabaseState.projectRowsPromise = new Promise((resolve) => {
      resolveProjects = resolve;
    });
    authState.current = { user: { id: 'user-1' }, loading: false };

    render(<ProjectsPage />);

    const title = await screen.findByText('Cached Project');
    const card = title.closest('[role="link"]');
    expect(card).toBeTruthy();

    fireEvent.click(card!);
    expect(await screen.findByTestId('project-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('project-editor-back'));

    await waitFor(() => {
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null;
      expect(overlay?.style.visibility).toBe('hidden');
    });

    await act(async () => {
      resolveProjects({
        data: [{
          id: 'project-1',
          title: 'Late Server Refresh',
          cover_url: null,
          updated_at: '2026-05-31T00:01:00.000Z',
          created_at: '2026-05-31T00:00:00.000Z',
        }],
        error: null,
      });
      await Promise.resolve();
    });

    expect(screen.getByText('Cached Project')).toBeTruthy();
    expect(screen.queryByText('Late Server Refresh')).toBeNull();
  });
});
