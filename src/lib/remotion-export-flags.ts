export function isRemotionExportTaskId(taskId: string | null | undefined): boolean {
  return taskId?.startsWith('remotion-export-') === true;
}

export function remotionExportLookupId(id: string): string | undefined {
  return /^(?:remotion-export-(?:pending-)?)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(id)?.[1].toLowerCase();
}

export function remotionExportJobId(taskId: string | null | undefined): string | undefined {
  if (!taskId || !/^remotion-export-/i.test(taskId)) return undefined;
  return remotionExportLookupId(taskId);
}
