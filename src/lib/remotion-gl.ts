export function usesThreeCanvas(code: string): boolean {
  return /\bThreeCanvas\b|@remotion\/three\b/.test(code);
}

// ThreeCanvas needs WebGL2 even on a worker without a hardware graphics adapter.
export function remotionChromiumOptions(code: string) {
  return { disableWebSecurity: true, gl: usesThreeCanvas(code) ? 'swangle' as const : null };
}
