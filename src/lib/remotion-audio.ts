export function hasRemotionAudioSources(code: string): boolean {
  const mediaComponent = String.raw`(?:Remotion\.)?(?:Audio|Video|OffthreadVideo)`
  if (new RegExp(String.raw`<\s*${mediaComponent}\b|React\.createElement\(\s*${mediaComponent}\b`).test(code)) {
    return true
  }

  const createElementAliases = [...code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*React\.createElement\s*;?/g,
  )].map(match => match[1])

  return createElementAliases.some(alias => {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(String.raw`\b${escapedAlias}\(\s*${mediaComponent}\b`).test(code)
  })
}
