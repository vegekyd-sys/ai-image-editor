import { describe, expect, it } from 'vitest';
import {
  buildStudioCreativeArtifacts,
  canvasAspectRatio,
  studioCreativePacketSchema,
} from '../src/lib/studio-run/creative-packet';
import { validateStudioArtifact, type StudioDeliveryPromise } from '../src/lib/studio-run/contracts';

const deliveryPromise: StudioDeliveryPromise = {
  durationSeconds: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  renderRuntime: 'remotion',
  compositionMode: 'editable',
  audioRequired: true,
  subtitlesRequired: true,
};

const packet = studioCreativePacketSchema.parse({
  title: 'Makaron in 30 seconds',
  objective: 'Explain Makaron clearly and memorably.',
  audience: 'Solo creators',
  coreMessage: 'One person can direct a complete creative studio.',
  language: 'zh-CN',
  concepts: [
    {
      id: 'portal',
      title: 'Creative portal',
      hook: 'A spark opens a studio.',
      visualDirection: 'A mascot travels through connected creative worlds.',
      motionLanguage: 'Large camera moves with layered reveals.',
    },
    {
      id: 'desk',
      title: 'One-person desk',
      hook: 'One desk becomes a production floor.',
      visualDirection: 'Tools assemble around a working creator.',
      motionLanguage: 'Tactile object choreography and match cuts.',
    },
  ],
  selectedConceptId: 'portal',
  rationale: 'The portal makes the product transformation visible.',
  estimatedCostUsd: 0.6,
  sections: [
    { id: 'hook', startSeconds: 0, endSeconds: 8, narration: 'Meet Makaron.', onScreenText: ['Meet Makaron'] },
    { id: 'body', startSeconds: 8, endSeconds: 23, narration: 'Turn an idea into a complete production.', onScreenText: ['Idea to production'] },
    { id: 'end', startSeconds: 23, endSeconds: 30, narration: 'Your one-person studio.', onScreenText: ['One person. One studio.'] },
  ],
});

describe('Studio creative packet projection', () => {
  it('projects one model packet into three independently valid stage artifacts', () => {
    const projected = buildStudioCreativeArtifacts({ packet, deliveryPromise });

    expect(projected.map(item => item.stage)).toEqual(['brief', 'proposal', 'script']);
    for (const item of projected) {
      expect(() => validateStudioArtifact(item.stage, item.artifact)).not.toThrow();
    }
    expect(projected[0].artifact).toMatchObject({ durationSeconds: 30, aspectRatio: '16:9' });
    expect(projected[1].artifact).toMatchObject({ deliveryPromise, selectedConceptId: 'portal' });
    expect(projected[2].artifact).toMatchObject({ totalDurationSeconds: 30 });
  });

  it('keeps unusual canvases deterministic and rejects an unknown concept selection', () => {
    expect(canvasAspectRatio(1080, 1920)).toBe('9:16');
    expect(() => studioCreativePacketSchema.parse({
      ...packet,
      selectedConceptId: 'missing',
    })).toThrow(/selectedConceptId/);
  });
});
