import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  compress: vi.fn(), push: vi.fn(), canvas: null as any, panel: null as any,
  reconnect: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/hooks/useAgentRun', () => ({ useAgentRun: () => ({ activeRunId: null, reconnect: mocks.reconnect, disconnect: mocks.disconnect }) }));
vi.mock('@/lib/imageUtils', () => ({ compressBase64Image: mocks.compress, compressImageFile: vi.fn(), isHeicFile: () => false }));
vi.mock('@/lib/agentStream', () => ({ streamAgent: vi.fn(async () => {}) }));
vi.mock('@/lib/babel-status', () => ({ getBabelStatus: () => ({ status: 'ready' }), subscribeBabelStatus: () => () => {} }));
vi.mock('@/lib/imageCache', () => ({ cacheImage: vi.fn(), updateCachedTips: vi.fn() }));
vi.mock('@/components/ImageCanvas', () => ({ default: (props: any) => { mocks.canvas = props; return <div data-testid="image-canvas" />; } }));
vi.mock('@/components/AgentChatView', () => ({ default: () => null }));
vi.mock('@/components/AgentStatusBar', () => ({ default: () => null }));
vi.mock('@/components/AnnotationToolbar', () => ({ default: () => null }));
vi.mock('@/components/CreditPopup', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/SaveMediaDialog', () => ({ default: () => null }));
vi.mock('@/components/VideoResultCard', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: (load: () => unknown) => load.toString().includes('DesignEditPanel')
  ? (props: any) => { mocks.panel = props; return <div data-testid="editable-panel" />; } : () => null }));
import Editor from '@/components/Editor';


const fields = [
  { id: 'title', propKey: 'title', type: 'text' as const, label: 'Title' },
  { id: 'photo', propKey: 'photo', type: 'image' as const, label: 'Photo' },
  { id: 'layer', propKey: 'layer', type: 'image' as const, label: 'Layer' },
  { id: 'clip', propKey: 'clip', type: 'video' as const, label: 'Video' },
];
const snapshots = [{ id: 'source', image: '/poster.png', tips: [], messageId: '', type: 'edit' as const,
  design: { code: 'function Composition() { return null; }', width: 800, height: 600,
    props: { title: 'Source', photo: '/photo.png', layer: '/layer.png', clip: '/clip.mp4' }, editables: fields } }];
beforeEach(() => { vi.clearAllMocks(); mocks.canvas = null; mocks.panel = null; localStorage.clear(); localStorage.setItem('mkr_auto_tips', 'off'); localStorage.setItem('locale', 'zh'); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ balance: 100, skills: [] }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(readOnly: boolean, viewerSignedIn = false) {
  const save = vi.fn(); render(<LocaleProvider initialLocale="zh"><Editor projectId="public" initialSnapshots={snapshots}
    readOnly={readOnly} viewerSignedIn={viewerSignedIn} onSaveDesignProps={save} /></LocaleProvider>); return save;
}
describe('one shared Editable permission gate', () => {
  it('shows every type and permits selection, but sends anonymous edits to login without changing data', async () => {
    const save = mount(true); await waitFor(() => expect(mocks.panel?.editables).toHaveLength(4));
    expect(mocks.canvas.editableFields).toEqual(fields);
    act(() => mocks.canvas.onSelectEditable('layer')); expect(mocks.canvas.selectedEditableId).toBe('layer'); expect(mocks.push).not.toHaveBeenCalled();
    act(() => { expect(mocks.canvas.onBeforeEditableEdit()).toBe(false); });
    act(() => mocks.panel.onStartEdit('title')); act(() => mocks.canvas.onUpdateProp('_pos_layer', { x: 20, y: 10 }));
    act(() => mocks.panel.onUpdateProp('_layerState', { order: [], deleted: ['layer'] })); act(() => mocks.panel.onHistorySeek(0));
    expect(mocks.push).toHaveBeenCalledWith('/login'); expect(mocks.canvas.designProps.title).toBe('Source');
    expect(mocks.canvas.designProps._pos_layer).toBeUndefined(); expect(mocks.canvas.designProps._layerState).toBeUndefined(); expect(save).not.toHaveBeenCalled();
  });
  it('blocks signed-in non-owners without a login loop', async () => {
    const save = mount(true, true); await waitFor(() => expect(mocks.panel?.editables).toHaveLength(4));
    act(() => { expect(mocks.canvas.onBeforeEditableEdit()).toBe(false); }); act(() => mocks.panel.onStartEdit('clip')); act(() => mocks.canvas.onUpdateProp('title', 'Not allowed'));
    expect(screen.getByText('只有项目原账号可以编辑。')).toBeTruthy(); expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.canvas.designProps.title).toBe('Source'); expect(save).not.toHaveBeenCalled();
  });
  it('retains original-account layer edits and persistence', async () => {
    const save = mount(false, true); await waitFor(() => expect(mocks.panel?.editables).toHaveLength(4));
    expect(mocks.canvas.onBeforeEditableEdit()).toBe(true); act(() => mocks.canvas.onUpdateProp('_pos_layer', { x: 20, y: 10 }));
    expect(mocks.canvas.designProps._pos_layer).toEqual({ x: 20, y: 10 }); await waitFor(() => expect(save).toHaveBeenCalled()); expect(mocks.push).not.toHaveBeenCalled();
  });
});
