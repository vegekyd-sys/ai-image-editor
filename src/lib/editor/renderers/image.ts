import type { Snapshot } from '@/types';
import type { RendererContext, CanvasOverrides } from '../renderer-registry';

export const imageMatcher = {
  type: 'image' as const,

  matchesSnapshot(_snap: Snapshot, _ctx: RendererContext): boolean {
    // Default: always matches (must be registered last)
    return true;
  },

  getCanvasProps(): CanvasOverrides {
    return {};
  },
};
