import { describe, expect, it } from 'vitest';
import {
  summarizeRemotionFontTiming,
  type RemotionLambdaFontTimingShard,
} from '@/lib/remotion-lambda-renderer';
function shard(input: {
  initialFrame: number;
  totalMs: number;
  manifestMs: number;
  fontFacesMs: number;
  fontsReadyMs: number;
  fontsCheckMs: number;
  warm?: boolean;
}): RemotionLambdaFontTimingShard {
  return {
    initialFrame: input.initialFrame,
    artifactBytes: 200,
    artifactUrl: `https://example.test/${input.initialFrame}.json`,
    cacheHit: input.warm || false,
    totalMs: input.totalMs,
    manifestMs: input.manifestMs,
    selectionMs: 2,
    fontFacesMs: input.fontFacesMs,
    fontsReadyMs: input.fontsReadyMs,
    fontsCheckMs: input.fontsCheckMs,
    faceCount: 1,
    uniqueResourceCount: 1,
  };
}

describe('Remotion Lambda font timing aggregation', () => {
  it('summarizes parallel shard wall time without summing it', () => {
    const shards: RemotionLambdaFontTimingShard[] = [
      shard({
        initialFrame: 60,
        totalMs: 20,
        manifestMs: 4,
        fontFacesMs: 14,
        fontsReadyMs: 1,
        fontsCheckMs: 0.5,
        warm: true,
      }),
      shard({
        initialFrame: 0,
        totalMs: 10,
        manifestMs: 2,
        fontFacesMs: 7,
        fontsReadyMs: 0.5,
        fontsCheckMs: 0.25,
      }),
    ];

    const summary = summarizeRemotionFontTiming({
      telemetryId: 'telemetry-1',
      collectionMs: 12.345,
      artifactCount: 2,
      shards,
    });

    expect(summary.available).toBe(true);
    expect(summary.shardCount).toBe(2);
    expect(summary.coldShardCount).toBe(1);
    expect(summary.warmShardCount).toBe(1);
    expect(summary.maxTotalMs).toBe(20);
    expect(summary.avgTotalMs).toBe(15);
    expect(summary.maxFontFacesMs).toBe(14);
    expect(summary.maxSelectionMs).toBe(2);
    expect(summary.uniqueResourceRequestCount).toBe(2);
    expect(summary.observedTransferBytes).toBe(0);
    expect(summary.shards.map((shard) => shard.initialFrame)).toEqual([0, 60]);
  });

  it('reports unavailable telemetry explicitly', () => {
    const summary = summarizeRemotionFontTiming({
      telemetryId: 'telemetry-2',
      collectionMs: 1,
      artifactCount: 0,
      shards: [],
      errors: ['No artifacts'],
    });

    expect(summary.available).toBe(false);
    expect(summary.maxTotalMs).toBeNull();
    expect(summary.errors).toEqual(['No artifacts']);
  });
});
