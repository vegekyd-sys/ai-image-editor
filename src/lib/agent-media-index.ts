export interface AgentSnapshotIndexRow {
  id?: string | null;
  image_url?: string | null;
  type?: string | null;
  video_meta?: Record<string, unknown> | null;
}

export function snapshotUrlForAgent(row: AgentSnapshotIndexRow, fallback = ''): string {
  if (row.type === 'video') {
    const videoUrl = row.video_meta?.videoUrl;
    if (typeof videoUrl === 'string' && videoUrl) return videoUrl;
  }
  return row.image_url || fallback;
}

export function rebuildAgentSnapshotUrls(
  rows: AgentSnapshotIndexRow[],
  existing: string[],
): string[] {
  const indexed = rows.map((row, index) => snapshotUrlForAgent(row, existing[index] || ''));
  return [...indexed, ...existing.slice(rows.length)];
}

export function findSnapshotMediaIndex(
  rows: AgentSnapshotIndexRow[],
  snapshotId: string | undefined,
): number | undefined {
  if (!snapshotId) return undefined;
  const index = rows.findIndex(row => row.id === snapshotId);
  return index >= 0 ? index + 1 : undefined;
}
