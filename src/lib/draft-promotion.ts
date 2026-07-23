import { createHash } from 'node:crypto';

export function stableDraftPromotionSnapshotId(input: {
  projectId: string;
  agentRunId?: string;
  designPath: string;
}): string {
  const digest = createHash('sha256')
    .update(`${input.projectId}\n${input.agentRunId || 'interactive'}\n${input.designPath}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  digest[12] = '5';
  digest[16] = ['8', '9', 'a', 'b'][Number.parseInt(digest[16], 16) % 4];
  const value = digest.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
