export const IOS_PREAUTH_TRIAL_CONTINUATION_KEY = 'makaron:ios-preauth-trial-continuation'

export interface IOSPreAuthTrialContinuation {
  kind: 'skill' | 'create'
  skillId?: string
  confirmed: boolean
  linked: boolean
  createdAt: number
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000

function availableStorages(): Storage[] {
  if (typeof window === 'undefined') return []
  return [window.sessionStorage, window.localStorage]
}

export function readIOSPreAuthTrialContinuation(): IOSPreAuthTrialContinuation | null {
  for (const storage of availableStorages()) {
    const raw = storage.getItem(IOS_PREAUTH_TRIAL_CONTINUATION_KEY)
    if (!raw) continue
    try {
      const value = JSON.parse(raw) as IOSPreAuthTrialContinuation
      const validKind = value.kind === 'skill' || value.kind === 'create'
      const fresh = Number.isFinite(value.createdAt) && Date.now() - value.createdAt <= MAX_AGE_MS
      if (validKind && fresh) return value
    } catch {}
  }
  clearIOSPreAuthTrialContinuation()
  return null
}

export function writeIOSPreAuthTrialIntent(input: {
  kind: IOSPreAuthTrialContinuation['kind']
  skillId?: string
}): IOSPreAuthTrialContinuation {
  const value: IOSPreAuthTrialContinuation = {
    kind: input.kind,
    skillId: input.skillId,
    confirmed: false,
    linked: false,
    createdAt: Date.now(),
  }
  const serialized = JSON.stringify(value)
  availableStorages().forEach(storage => storage.setItem(IOS_PREAUTH_TRIAL_CONTINUATION_KEY, serialized))
  return value
}

export function confirmIOSPreAuthTrialContinuation(): IOSPreAuthTrialContinuation | null {
  const existing = readIOSPreAuthTrialContinuation()
  if (!existing) return null
  const confirmed = { ...existing, confirmed: true, linked: false }
  const serialized = JSON.stringify(confirmed)
  availableStorages().forEach(storage => storage.setItem(IOS_PREAUTH_TRIAL_CONTINUATION_KEY, serialized))
  return confirmed
}

export function linkIOSPreAuthTrialContinuation(): IOSPreAuthTrialContinuation | null {
  const existing = readIOSPreAuthTrialContinuation()
  if (!existing?.confirmed) return null
  const linked = { ...existing, linked: true }
  const serialized = JSON.stringify(linked)
  availableStorages().forEach(storage => storage.setItem(IOS_PREAUTH_TRIAL_CONTINUATION_KEY, serialized))
  return linked
}

export function clearIOSPreAuthTrialContinuation(): void {
  availableStorages().forEach(storage => storage.removeItem(IOS_PREAUTH_TRIAL_CONTINUATION_KEY))
}
