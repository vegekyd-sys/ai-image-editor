import { describe, expect, it } from 'vitest';
import {
  compositionDraftPath,
  createPersistedCompositionDraft,
  parsePersistedCompositionDraft,
} from '@/lib/composition-draft';

const design = {
  code: 'function Composition() { return <AbsoluteFill />; }',
  width: 1920,
  height: 1080,
  animation: { fps: 30, durationInSeconds: 20 },
};

describe('composition draft persistence', () => {
  it('uses one project-scoped recovery path across agent runs', () => {
    expect(compositionDraftPath('project-1')).toBe('project-1/drafts/latest-composition.json');
  });

  it('stores recovery metadata alongside a renderable design payload', () => {
    const draft = createPersistedCompositionDraft(design, {
      savedAt: '2026-07-11T00:00:00.000Z',
      sourceDesignPath: 'project-1/code/source.json',
    });

    expect(draft.code).toBe(design.code);
    expect(draft.animation).toEqual(design.animation);
    expect(draft.__makaronDraft).toEqual({
      version: '1.0',
      savedAt: '2026-07-11T00:00:00.000Z',
      sourceDesignPath: 'project-1/code/source.json',
    });
    expect(parsePersistedCompositionDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it('rejects malformed recovery files', () => {
    expect(parsePersistedCompositionDraft({ code: '', width: 1, height: 1 })).toBeNull();
  });
});
