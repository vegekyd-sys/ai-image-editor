export function hasRemotionAudioSources(code: string): boolean {
  return /<\s*(?:Audio|Video)\b|React\.createElement\(\s*(?:Audio|Video)\b/.test(code)
}
