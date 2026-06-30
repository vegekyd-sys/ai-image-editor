export function filterWorkspaceFilesForAgentScope<T extends { path: string; isBuiltIn?: boolean }>(
  files: T[],
  projectId: string,
  pattern?: string,
): T[] {
  if (pattern) return files;

  const currentProjectPrefixes = [
    `${projectId}/`,
    `projects/${projectId}/`,
  ];
  const userLevelPrefixes = ['skills/', 'memory/', 'prompts/'];

  return files.filter(file =>
    file.isBuiltIn ||
    currentProjectPrefixes.some(prefix => file.path.startsWith(prefix)) ||
    userLevelPrefixes.some(prefix => file.path.startsWith(prefix)),
  );
}
