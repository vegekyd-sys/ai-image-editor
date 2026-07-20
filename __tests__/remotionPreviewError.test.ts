import { describe, expect, it } from 'vitest';
import { remotionPreviewFailure } from '@/lib/remotion-preview-error';

describe('Remotion preview decoder failures', () => {
  it('marks deterministic video decode errors terminal and blocks component churn', () => {
    const failure = remotionPreviewFailure(
      'Cannot decode https://cdn.example.com/source.mp4.',
      'Failed to capture frame 60',
    );

    expect(failure).toMatchObject({
      code: 'composition_video_decode',
      retryable: false,
      terminal: true,
    });
    expect(failure.error).toContain('not a composition-code failure');
    expect(failure.error).toContain('Do not rewrite <Video>/<OffthreadVideo>');
    expect(failure.error).toContain('do not create a compatibility copy');
  });

  it('keeps unrelated render errors unclassified', () => {
    expect(remotionPreviewFailure('Font load timeout', 'Failed to capture frame 30')).toEqual({
      error: 'Failed to capture frame 30: Font load timeout',
    });
  });
});
