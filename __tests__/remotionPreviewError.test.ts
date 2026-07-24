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
});
