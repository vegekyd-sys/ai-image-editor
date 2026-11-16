import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as { id: string } | null, failHistory: false, isPublic: true,
  t: (key: string) => key, router: { push: vi.fn(), replace: vi.fn() }, lastProps: null as any, saveOriginal: vi.fn(), replace: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ locale: 'en', t: state.t }) }));
const design = { code: 'function Scene() {}', width: 800, height: 600, props: { title: 'Source' }, editables: [{ id: 'title', propKey: 'title', type: 'text' as const, label: 'Title' }] };
const loadProject = async () => {
  if (state.failHistory) throw new Error('History unavailable');
  return ({ ownerId: 'author', isPublic: state.isPublic, snapshots: [{ id: 'snap', design, image: '/poster.png', tips: [], messageId: '' }], messages: [], title: 'Source', animations: [], timelineVersion: 2, musicRows: [] });
};
vi.mock('@/hooks/useProject', () => ({ useProject: () => ({ loadProject, saveDesignProps: state.saveOriginal }) }));
vi.mock('@/lib/imageCache', () => ({
  getCachedProjectDataSync: () => null, getPendingProjectImagesSync: () => null, getPendingProjectLaunchSync: () => null,
  hasPendingProjectImages: () => false, getCachedProjectData: async () => null, getCachedImages: async () => new Map(),
  cacheProjectData: vi.fn(),
}));
vi.mock('@/components/Editor', () => ({ default: (props: any) => { state.lastProps = props; return <div data-testid="editor" />; } }));
import ProjectEditorContainer from '@/components/ProjectEditorContainer';
beforeEach(() => { vi.clearAllMocks(); state.user = null; state.failHistory = false; state.isPublic = true; state.lastProps = null; sessionStorage.clear(); });
afterEach(cleanup);
describe('public visibility and original-account editing', () => {
  it.each([null, { id: 'another-account' }])('shows source without write callbacks to viewer %j', async user => {
    state.user = user; render(<ProjectEditorContainer projectId="public" />);
    await waitFor(() => expect(state.lastProps?.initialSnapshots[0]?.id).toBe('snap'));
    expect(state.lastProps.readOnly).toBe(true);
    expect(state.lastProps.viewerSignedIn).toBe(Boolean(user));
    expect(state.lastProps.onSaveSnapshot).toBeUndefined();
    expect(state.lastProps.onSaveDesignProps).toBeUndefined();
    expect(state.lastProps.initialSnapshots[0].design.props.title).toBe('Source');
  });
  it.each([true, false])('retains original-account editing for public=%j', async isPublic => {
    state.user = { id: 'author' }; state.isPublic = isPublic;
    render(<ProjectEditorContainer projectId="public" />);
    await waitFor(() => expect(state.lastProps?.readOnly).toBe(false));
    expect(state.lastProps.onSaveDesignProps).toBe(state.saveOriginal);
  });
  it('does not render a private project for visitors', async () => {
    state.isPublic = false; render(<ProjectEditorContainer projectId="private" />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/login'));
    expect(state.lastProps).toBeNull();
  });
});

describe('layer project opening', () => {
  function opening() {
    return Promise.resolve({
      projectId: 'private', snapshotId: 'snap', designPath: 'code/layers.json', ownerId: 'author', isPublic: false,
      title: 'Layers', timelineVersion: 2, design,
      snapshots: [{ id: 'snap', designPath: 'code/layers.json', image: '/poster.png', messageId: '', tips: [] }],
    });
  }
  it('lets the owner edit the streamed design even when history fails', async () => {
    state.failHistory = true; state.user = { id: 'author' };
    const entry = opening();
    const streamed = { then(resolve: (value: Awaited<typeof entry>) => void) { void entry.then(resolve); } };
    render(<ProjectEditorContainer projectId="private" openingLayers={streamed as unknown as typeof entry} />);
    await waitFor(() => expect(state.lastProps?.initialSnapshots[0].design).toBe(design));
    expect(state.lastProps.readOnly).toBe(false);
  });
  it('withholds the private seed from another account and permits a fresh load on retry', async () => {
    state.failHistory = true; state.user = { id: 'viewer' };
    const view = render(<ProjectEditorContainer projectId="private" openingLayers={opening()} />);
    const retry = await view.findByRole('button', { name: 'project.retry' });
    expect(state.lastProps).toBeNull();
    state.failHistory = false; state.isPublic = false;
    fireEvent.click(retry);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/projects'));
    expect(state.lastProps).toBeNull();
  });
});
