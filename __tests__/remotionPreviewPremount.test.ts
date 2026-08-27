import { describe, expect, it } from 'vitest';
import { getPreviewPremountFrames } from '@/lib/remotion-preview-premount';

describe('Remotion preview premount budget', () => {
  it('keeps desktop warmup scene-relative instead of mounting the whole opening', () => {
    expect(getPreviewPremountFrames({ authoredDuration: 50, fps: 30, iosWebKit: false }))
      .toBe(65);
    expect(getPreviewPremountFrames({ authoredDuration: 180, fps: 30, iosWebKit: false }))
      .toBe(120);
  });

  it('limits rapid desktop cuts to the active clip and its immediate successor', () => {
    expect(getPreviewPremountFrames({ authoredDuration: 15, fps: 30, iosWebKit: false }))
      .toBe(45);
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
    expect(getPreviewPremountFrames({ authoredDuration: Number.NaN, fps: 30, iosWebKit: false }))
      .toBe(45);
  });
});
