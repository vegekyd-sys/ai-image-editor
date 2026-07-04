import type { Snapshot } from '@/types';
import type { RendererContext, CanvasOverrides } from '../renderer-registry';

export const designMatcher = {
  type: 'design' as const,

  matchesSnapshot(snap: Snapshot, ctx: RendererContext): boolean {
    // Design mode: any persisted Remotion design, editable or not.
    // Editables only control the overlay; they are not required for preview.
    if (snap.type === 'video') return false;
    if (ctx.isAtDraftSlot) return false;
    return !!snap.design;
  },

  getCanvasProps(snap: Snapshot): CanvasOverrides {
    return {
      editableFields: snap.design?.editables,
      designProps: (snap.design?.props || {}) as Record<string, unknown>,
    };
  },
};
