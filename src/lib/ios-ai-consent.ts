export function requiresIOSAIDataConsent(requiredBuilds: string, build?: string): boolean {
  const policy = requiredBuilds.trim();
  if (policy === 'none') return false;
  if (!policy || policy === 'all') return true;
  const builds = policy.split(',').map(value => value.trim());
  if (builds.some(value => !/^\d+$/.test(value))) return true;
  if (!build || !/^\d+$/.test(build)) return true;
  return builds.includes(build);
}

export async function getIOSAIConsentAppBuild(): Promise<string | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        return info.id === 'app.makaron.ios' ? info.build : undefined;
      })(),
      new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 2500); }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
