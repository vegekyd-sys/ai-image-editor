interface StudioRunToolHistoryRow {
  input?: unknown;
  created_at?: string | null;
}

export interface StudioDeliveryVideo {
  outputPath: string;
  editableSourcePath?: string;
  createdAt?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractStudioDeliveryVideo(
  rows: StudioRunToolHistoryRow[] | null | undefined,
): StudioDeliveryVideo | null {
  for (const row of rows ?? []) {
    const input = asRecord(row.input);
    if (input?.operation !== 'put_artifact' || input.stage !== 'delivery') continue;
    const artifact = asRecord(input.artifact);
    const outputPath = typeof artifact?.outputPath === 'string'
      ? artifact.outputPath.trim()
      : '';
    if (!outputPath) continue;

    const editableSourcePath = typeof artifact?.editableSourcePath === 'string'
      ? artifact.editableSourcePath.trim()
      : '';
    return {
      outputPath,
      ...(editableSourcePath ? { editableSourcePath } : {}),
      ...(row.created_at ? { createdAt: row.created_at } : {}),
    };
  }
  return null;
}
