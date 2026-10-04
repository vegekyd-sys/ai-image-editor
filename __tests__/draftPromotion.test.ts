import { describe, expect, it } from 'vitest';
import { stableDraftPromotionSnapshotId } from '../src/lib/draft-promotion';

describe('draft promotion identity', () => {
  it('keeps retries and resumed attempts on one Snapshot', () => {
    const input = {
      projectId: 'project-1',
      agentRunId: 'agent-run-1',
      designPath: 'project-1/drafts/latest-composition.json',
    };

    expect(stableDraftPromotionSnapshotId(input))
      .toBe(stableDraftPromotionSnapshotId(input));
    expect(stableDraftPromotionSnapshotId(input))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('separates independent Agent Runs and design paths', () => {
    const base = {
      projectId: 'project-1',
      agentRunId: 'agent-run-1',
      designPath: 'project-1/drafts/latest-composition.json',
    };

    expect(stableDraftPromotionSnapshotId(base)).not.toBe(stableDraftPromotionSnapshotId({
      ...base,
      agentRunId: 'agent-run-2',
    }));
    expect(stableDraftPromotionSnapshotId(base)).not.toBe(stableDraftPromotionSnapshotId({
      ...base,
      designPath: 'project-1/drafts/alternate-composition.json',
    }));
  });
});
