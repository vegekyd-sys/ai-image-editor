import { describe, expect, it } from 'vitest';
import { getPreviewPremountFrames } from '@/lib/remotion-preview-premount';

describe('Remotion preview premount budget', () => {
  it('keeps the long desktop warmup window', () => {
    expect(getPreviewPremountFrames({ authoredDuration: 50, fps: 30, iosWebKit: false }))
      .toBe(240);
  });

  it('limits rapid iOS cuts to a scene-relative lead', () => {
    expect(getPreviewPremountFrames({ authoredDuration: 50, fps: 30, iosWebKit: true }))
      .toBe(65);
  });

  it('gives long iOS source ranges more seek time without exceeding six seconds', () => {
    expect(getPreviewPremountFrames({ authoredDuration: 135, fps: 30, iosWebKit: true }))
      .toBe(150);
    expect(getPreviewPremountFrames({ authoredDuration: 300, fps: 30, iosWebKit: true }))
      .toBe(180);
  });

  it('uses a bounded fallback for missing authored duration', () => {
    expect(getPreviewPremountFrames({ authoredDuration: Number.NaN, fps: 30, iosWebKit: true }))
      .toBe(45);
  });
});
