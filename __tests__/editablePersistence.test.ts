import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  createPersistedEditableDesign,
  mergePersistedEditableProps,
} from '@/lib/editor/editable-persistence';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('editable persistence', () => {
  it('preserves move, scale, trim, media, and font overrides in the saved design', () => {
    const persisted = createPersistedEditableDesign({
      code: 'function Composition() { return null; }',
      width: 1080,
      height: 1920,
      animation: { fps: 30, durationInSeconds: 10 },
      props: {
        title: 'Edited title',
        heroImage: 'https://example.com/hero.jpg',
        _pos_title: { x: 120, y: -48 },
        _scale_heroImage: { w: 1.25, h: 1.25 },
        _trimBefore_clip: 30,
        _trimAfter_clip: 240,
      },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
        { id: 'heroImage', type: 'image', label: 'Hero image', propKey: 'heroImage' },
      ],
      fontSubstitutions: { Arial: 'Inter' },
    });

    expect(persisted.props).toMatchObject({
      _pos_title: { x: 120, y: -48 },
      _scale_heroImage: { w: 1.25, h: 1.25 },
      _trimBefore_clip: 30,
      _trimAfter_clip: 240,
    });
    expect(persisted.editables).toHaveLength(2);
    expect(persisted.fontSubstitutions).toEqual({ Arial: 'Inter' });
  });

  it('rejects malformed design payloads before overwriting workspace state', () => {
    expect(() => createPersistedEditableDesign({
      code: '',
      width: 1080,
      height: 1920,
    })).toThrow('design code');
    expect(() => createPersistedEditableDesign({
      code: 'function Composition() { return null; }',
      width: Number.NaN,
      height: 1920,
    })).toThrow('design dimensions');
  });

  it('keeps existing overrides and draft metadata while the latest props win', () => {
    const first = mergePersistedEditableProps({
      code: 'function Composition() { return null; }',
      width: 1080,
      height: 1920,
      props: {
        title: 'Original',
        _scale_title: { w: 1.2, h: 1.2 },
        _trimBefore_clip: 12,
      },
      __makaronDraft: { source: 'studio-run' },
    }, {
      _pos_title: { x: 80, y: 40 },
    }, 100);
    const second = mergePersistedEditableProps(first, {
      title: 'Latest',
      _pos_title: { x: 160, y: 90 },
    }, 101);

    expect(second.props).toMatchObject({
      title: 'Latest',
      _pos_title: { x: 160, y: 90 },
      _scale_title: { w: 1.2, h: 1.2 },
      _trimBefore_clip: 12,
    });
    expect(second.__makaronDraft).toEqual({ source: 'studio-run' });
    expect(second.__makaronEditableRevision).toBe(101);
  });

  it('persists through the authenticated server and flushes pending edits on page exit', () => {
    const route = read('src/app/api/projects/[id]/snapshots/[snapshotId]/design/route.ts');
    const projectHook = read('src/hooks/useProject.ts');
    const editor = read('src/components/Editor.tsx');

    expect(route).toContain('supabase.auth.getUser()');
    expect(route).toContain(".select('user_id')");
    expect(route).toContain(".select('design_path')");
    expect(route).toContain('snapshot.design_path');
    expect(route).toContain('workspace.writeFile(');
    expect(route).toContain("console.error('[design-persistence]'");

    expect(projectHook).toContain('/snapshots/${encodeURIComponent(snapshotId)}/design');
    expect(projectHook).toContain('keepalive: options.propsOnly === true');
    expect(projectHook).toContain('if (!response.ok)');

    expect(editor).toContain("window.addEventListener('pagehide', flushPendingDesignSave)");
    expect(editor).toContain('pendingDesignSaveRef');
    expect(editor).not.toContain('designPropsSaveTimer.current = setTimeout(() => {');
  });
});
