import { describe, expect, it } from 'vitest';
import { validateDesign } from '../src/lib/design-harness';
import { buildStudioCompositionScaffold } from '../src/lib/studio-composition-scaffold';

describe('Studio composition scaffold', () => {
  it('creates a concise compilable checkpoint from the approved storyboard', () => {
    const design = buildStudioCompositionScaffold({
      run: {
        id: 'studio-1',
        deliveryPromise: {
          durationSeconds: 30,
          width: 1920,
          height: 1080,
          fps: 30,
          renderRuntime: 'remotion',
          compositionMode: 'editable',
          audioRequired: true,
          subtitlesRequired: true,
        },
      },
      storyboard: {
        scenes: [
          { id: 'hook', startSeconds: 0, endSeconds: 8, purpose: 'Introduce Makaron', focalPoint: 'Makaron', visualTreatment: 'Bold macro type', transitionOut: 'hard cut' },
          { id: 'proof', startSeconds: 8, endSeconds: 30, purpose: 'Show the workflow', focalPoint: 'One person directing agents', visualTreatment: 'Workspace montage', transitionOut: 'resolve' },
        ],
        artDirection: 'Bright editorial technology',
        layoutContract: 'One focal subject per scene',
        subtitleSafeArea: '8% inset',
      },
      script: {
        sections: [
          { id: 'hook', startSeconds: 0, endSeconds: 8, onScreenText: ['Makaron', 'One man studio'] },
          { id: 'proof', startSeconds: 8, endSeconds: 30, onScreenText: ['Direct the work', 'Keep the craft'] },
        ],
      },
    });

    expect(validateDesign({ code: design.code, props: design.props })).toBeNull();
    expect(design.code.length).toBeLessThan(9_000);
    expect(design.animation).toEqual({ fps: 30, durationInSeconds: 30 });
    expect(design.props?.scenes).toHaveLength(2);
    expect(design.description).toContain('[studio-scaffold:studio-1]');
    expect(design.__makaronScaffold).toBe(true);
  });
});
