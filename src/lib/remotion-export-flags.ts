export function isRemotionExportTaskId(taskId: string | null | undefined): boolean {
  return taskId?.startsWith('remotion-export-') === true;
}

export function remotionExportJobId(taskId: string | null | undefined): string | undefined {
  return /^remotion-export-(?:pending-)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(taskId || '')?.[1].toLowerCase();
}
