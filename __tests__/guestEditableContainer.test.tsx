import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as { id: string } | null, loaded: true, isPublic: true,
  t: (key: string) => key, router: { push: vi.fn(), replace: vi.fn() }, draft: null as any, lastProps: null as any, saveOriginal: vi.fn(), writeDraft: vi.fn(), replace: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ locale: 'en', t: state.t }) }));
const design = { code: 'function Scene() {}', width: 800, height: 600, props: { title: 'Source' }, editables: [{ id: 'title', propKey: 'title', type: 'text', label: 'Title' }] };
const loadProject = async () => ({ ownerId: 'author', isPublic: state.isPublic, snapshots: [{ id: 'snap', design, image: '/poster.png', tips: [], messageId: '' }], messages: [], title: 'Source', animations: [], timelineVersion: 2, musicRows: [] });
vi.mock('@/hooks/useProject', () => ({ useProject: () => ({ loadProject, saveDesignProps: state.saveOriginal }) }));
vi.mock('@/lib/imageCache', () => ({
  getCachedProjectDataSync: () => null, getPendingProjectImagesSync: () => null, getPendingProjectLaunchSync: () => null,
  hasPendingProjectImages: () => false, getCachedProjectData: async () => null, getCachedImages: async () => new Map(),
  cacheProjectData: vi.fn(), readGuestEditableDraft: async () => state.draft, writeGuestEditableDraft: state.writeDraft,
}));
vi.mock('@/components/Editor', () => ({ default: (props: any) => { state.lastProps = props; return <div data-testid="editor" />; } }));
import ProjectEditorContainer from '@/components/ProjectEditorContainer';
beforeEach(() => { vi.clearAllMocks(); state.user = null; state.isPublic = true; state.draft = null; state.lastProps = null; state.writeDraft.mockResolvedValue(undefined); sessionStorage.clear(); });
afterEach(cleanup);
describe('visitor and owner persistence boundaries', () => {
  it('allows public visitors to use editables, and only saves a local draft', async () => {
    render(<ProjectEditorContainer projectId="public" />);
    await waitFor(() => expect(state.lastProps?.allowLocalEditing).toBe(true));
    expect(state.lastProps.readOnly).toBe(true);
    expect(state.lastProps.onSaveSnapshot).toBeUndefined();
    await act(async () => state.lastProps.onSaveDesignProps('snap', { ...design, props: { title: 'Guest' } }));
    expect(state.writeDraft).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'public', designs: { snap: expect.objectContaining({ props: { title: 'Guest' } }) } }));
    expect(state.saveOriginal).not.toHaveBeenCalled();
  });
  it('keeps normal owner persistence when there is no guest draft', async () => {
    state.user = { id: 'author' }; render(<ProjectEditorContainer projectId="public" />);
    await waitFor(() => expect(state.lastProps?.readOnly).toBe(false));
    expect(state.lastProps.allowLocalEditing).toBe(false);
    expect(state.lastProps.onSaveDesignProps).toBe(state.saveOriginal);
  });
  it('restores a guest draft after author login without giving it original-project writes', async () => {
    state.user = { id: 'author' }; state.draft = { version: 1, projectId: 'public', cachedAt: Date.now(), designs: { snap: { ...design, props: { title: 'Guest' } } } };
    render(<ProjectEditorContainer projectId="public" />);
    await waitFor(() => expect(state.lastProps?.initialSnapshots[0]?.design?.props?.title).toBe('Guest'));
    expect(state.lastProps.readOnly).toBe(true); expect(state.lastProps.onSaveDesignProps).not.toBe(state.saveOriginal);
  });
  it('does not render a private project for visitors', async () => {
    state.isPublic = false; render(<ProjectEditorContainer projectId="private" />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/login'));
    expect(state.lastProps).toBeNull();
  });
});
