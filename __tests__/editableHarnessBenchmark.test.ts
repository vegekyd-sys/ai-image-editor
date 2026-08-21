import { describe, expect, it } from 'vitest';
import { EDITABLE_HARNESS_BENCHMARK_CORPUS } from '../benchmarks/editable-harness-corpus';
import { runEditableHarnessBenchmark } from '../benchmarks/editable-harness-core';

describe('Editable Harness benchmark release gates', () => {
  it('keeps coverage high without adding editable repair pressure for the Agent', () => {
    const report = runEditableHarnessBenchmark(EDITABLE_HARNESS_BENCHMARK_CORPUS);

    expect(report.summary.cases).toBe(14);
    expect(report.summary.gates).toEqual({
      weightedCoverage: true,
      textCoverage: true,
      imageCoverage: true,
      videoCoverage: true,
      sourceIsolation: true,
      firstPassPublishable: true,
      idempotent: true,
      editableForcedRewrites: true,
    });
    expect(report.summary.passed).toBe(true);
  });
});
