import { describe, expect, it } from 'vitest';
import { remotionPreviewFailure } from '@/lib/remotion-preview-error';

describe('Remotion preview decoder failures', () => {
  it('classifies deterministic video decode errors without constraining repair', () => {
    const failure = remotionPreviewFailure(
      'Cannot decode https://cdn.example.com/source.mp4.',
      'Failed to capture frame 60',
    );

    expect(failure).toMatchObject({
      code: 'composition_video_decode',
    });
    expect(failure).not.toHaveProperty('retryable');
    expect(failure).not.toHaveProperty('terminal');
    expect(failure.error).toBe('Failed to capture frame 60: Cannot decode https://cdn.example.com/source.mp4.');
  });

  it('keeps unrelated render errors unclassified', () => {
    expect(remotionPreviewFailure('Font load timeout', 'Failed to capture frame 30')).toEqual({
      error: 'Failed to capture frame 30: Font load timeout',
    });
  });

  it('classifies Sandbox deployment failures without blaming generated media', () => {
    const failure = remotionPreviewFailure(
      'Status code 403 is not ok',
      'Failed to capture contact sheet',
    );

    expect(failure).toMatchObject({
      code: 'remotion_preview_infrastructure',
    });
    expect(failure.error).toContain('Preview service is temporarily unavailable');
    expect(failure.error).toContain('Preserve the current composition and generated assets');
    expect(failure.error).not.toContain('image URL');
    expect(failure.diagnostic).toBe('Failed to capture contact sheet: Status code 403 is not ok');
  });

  it('classifies a missing Remotion snapshot as deployment infrastructure', () => {
    expect(
      remotionPreviewFailure(
        'Snapshot not found.',
        'Failed to capture frame 0',
      ),
    ).toMatchObject({
      code: 'remotion_preview_infrastructure',
    });
  });
});
