export function isRemotionExportTaskId(taskId: string | null | undefined): boolean {
  return taskId?.startsWith('remotion-export-') === true;
}
