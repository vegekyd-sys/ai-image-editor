const AUTH_RETURN_BASE = 'https://makaron.local'

/**
 * Accept only same-origin application paths at the authentication boundary.
 * Keeping this parser shared by client and server prevents `next` from
 * becoming an open redirect while still allowing query/hash state.
 */
export function normalizeAuthReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 2048) return ''
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\u0000-\u001f]/.test(trimmed)) return ''

  try {
    const parsed = new URL(trimmed, AUTH_RETURN_BASE)
    if (parsed.origin !== AUTH_RETURN_BASE) return ''
    if (
      parsed.pathname === '/login' ||
      parsed.pathname === '/activate' ||
      parsed.pathname.startsWith('/api/auth/')
    ) return ''
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ''
  }
}

export function selectAuthReturnPath(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const normalized = normalizeAuthReturnPath(candidate)
    if (normalized) return normalized
  }
  return ''
}

export function buildLoginHref(returnPath: string | null | undefined): string {
  const normalized = normalizeAuthReturnPath(returnPath)
  return normalized ? `/login?next=${encodeURIComponent(normalized)}` : '/login'
}

export function getSkillIdFromAuthReturnPath(returnPath: string | null | undefined): string {
  const normalized = normalizeAuthReturnPath(returnPath)
  if (!normalized) return ''

  const parsed = new URL(normalized, AUTH_RETURN_BASE)
  const pathMatch = parsed.pathname.match(/^\/home\/([^/]+)$/)
  const rawSkillId = pathMatch?.[1] || (parsed.pathname === '/home' ? parsed.searchParams.get('skill') : '')
  if (!rawSkillId) return ''

  try {
    return decodeURIComponent(rawSkillId)
  } catch {
    return ''
  }
}

export function resolveAuthReturnPathForRuntime(
  returnPath: string | null | undefined,
  isIOSApp: boolean,
): { returnPath: string; skillId: string } {
  const normalized = normalizeAuthReturnPath(returnPath)
  const skillId = getSkillIdFromAuthReturnPath(normalized)
  if (!skillId) return { returnPath: normalized, skillId: '' }
  return {
    returnPath: isIOSApp ? '/home' : `/home?skill=${encodeURIComponent(skillId)}`,
    skillId,
  }
}

export function appendAuthReturnParam(
  returnPath: string | null | undefined,
  key: string,
  value: string,
): string {
  const normalized = normalizeAuthReturnPath(returnPath)
  if (!normalized) return ''
  const parsed = new URL(normalized, AUTH_RETURN_BASE)
  parsed.searchParams.set(key, value)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function resolveAuthCompletionDestination(
  returnPath: string | null | undefined,
  welcome: boolean,
): string {
  const destination = normalizeAuthReturnPath(returnPath) || '/projects'
  return welcome
    ? appendAuthReturnParam(destination, 'welcome', '1')
    : destination
}
