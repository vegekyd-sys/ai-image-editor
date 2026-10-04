function isLoopback(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function isIsolatedMakaronE2E(): boolean {
  return process.env.MAKARON_E2E === '1'
    && isLoopback(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
}
