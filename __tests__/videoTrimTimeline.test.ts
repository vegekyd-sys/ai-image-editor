import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  compositionFrameToSourceFrame,
  deriveSequenceStartFrame,
  getSourceDurationInFrames,
  sourceFrameToCompositionFrame,
} from '@/lib/editor/video-trim-timeline';

const canvasSource = readFileSync(join(process.cwd(), 'src/components/ImageCanvas.tsx'), 'utf8');
const editorSource = readFileSync(join(process.cwd(), 'src/components/DesignVideoTrimEditor.tsx'), 'utf8');

describe('editable video trim timeline', () => {
  it('uses the selected source video duration instead of the composition duration', () => {
    expect(getSourceDurationInFrames(15.046, 30, 285)).toBe(451);
  });

  it('never makes the source timeline shorter than an existing trim endpoint', () => {
    expect(getSourceDurationInFrames(undefined, 30, 285)).toBe(285);
    expect(getSourceDurationInFrames(8, 30, 285)).toBe(285);
  });

  it('derives the selected clip Sequence start from the visible video element', () => {
    expect(deriveSequenceStartFrame({
      compositionFrame: 210,
      sourceTimeSeconds: 7.1,
      trimStartFrame: 165,
      fps: 30,
    })).toBe(162);
  });

  it('maps source trim frames into the selected clip instead of composition frame zero', () => {
    expect(sourceFrameToCompositionFrame({
      sourceFrame: 165,
      trimStartFrame: 165,
      sequenceStartFrame: 162,
    })).toBe(162);
    expect(sourceFrameToCompositionFrame({
      sourceFrame: 285,
      trimStartFrame: 165,
      sequenceStartFrame: 162,
    })).toBe(282);
  });

  it('maps composition playback back to the selected source video playhead', () => {
    expect(compositionFrameToSourceFrame({
      compositionFrame: 220,
      trimStartFrame: 165,
      sequenceStartFrame: 162,
    })).toBe(223);
  });

  it('reads timing from the selected editable video element and scopes preview events by field', () => {
    expect(canvasSource).toContain('buildLegacySceneRegistry({')
    expect(canvasSource).toContain("findSceneMediaElement(editableEl, 'video')")
    expect(canvasSource).toContain('detail.fieldId !== activeTrimFieldId');
    expect(canvasSource).toContain('sourceFrameToCompositionFrame({');
    expect(canvasSource).toContain('compositionFrameToSourceFrame({');
  });

  it('dispatches source-video frames rather than treating trim as composition-relative', () => {
    expect(editorSource).toContain('fieldId,');
    expect(editorSource).toContain('sourceFrame,');
    expect(editorSource).not.toContain('compositionFrame: Math.max(0, sourceFrame - startFrame)');
    expect(editorSource).toContain('video.duration * ((i + 0.5) / thumbnails.length)');
  });
});
