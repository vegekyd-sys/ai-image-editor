export function hasRemotionAudioSources(code: string): boolean {
  return /<\s*(?:Remotion\.)?(?:Audio|Video|OffthreadVideo)\b|React\.createElement\(\s*(?:Remotion\.)?(?:Audio|Video|OffthreadVideo)\b/.test(code)
}
