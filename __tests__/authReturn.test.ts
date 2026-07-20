import { describe, expect, it } from 'vitest'
import {
  appendAuthReturnParam,
  buildLoginHref,
  getSkillIdFromAuthReturnPath,
  normalizeAuthReturnPath,
  resolveAuthReturnPathForRuntime,
  selectAuthReturnPath,
} from '@/lib/auth-return'

describe('authentication return paths', () => {
  it('keeps an explicit Skill return path through the login URL', () => {
    expect(buildLoginHref('/home/world-cup-mvp')).toBe(
      '/login?next=%2Fhome%2Fworld-cup-mvp',
    )
    expect(selectAuthReturnPath('/home/world-cup-mvp', '/projects')).toBe('/home/world-cup-mvp')
  })

  it('normalizes both Skill URL shapes after authentication', () => {
    expect(getSkillIdFromAuthReturnPath('/home/world-cup-mvp')).toBe('world-cup-mvp')
    expect(getSkillIdFromAuthReturnPath('/home?skill=world-cup-mvp')).toBe('world-cup-mvp')
    expect(resolveAuthReturnPathForRuntime('/home/world-cup-mvp', false)).toEqual({
      returnPath: '/home?skill=world-cup-mvp',
      skillId: 'world-cup-mvp',
    })
    expect(resolveAuthReturnPathForRuntime('/home/world-cup-mvp', true)).toEqual({
      returnPath: '/home',
      skillId: 'world-cup-mvp',
    })
  })

  it('preserves registration state without losing the Skill destination', () => {
    expect(appendAuthReturnParam('/home/world-cup-mvp', 'welcome', '1')).toBe(
      '/home/world-cup-mvp?welcome=1',
    )
  })

  it('rejects external, protocol-relative, auth-loop, control-character, and oversized targets', () => {
    expect(normalizeAuthReturnPath('https://evil.example/steal')).toBe('')
    expect(normalizeAuthReturnPath('//evil.example/steal')).toBe('')
    expect(normalizeAuthReturnPath('/login?next=/projects')).toBe('')
    expect(normalizeAuthReturnPath('/api/auth/callback?code=secret')).toBe('')
    expect(normalizeAuthReturnPath('/home\nSet-Cookie: bad=1')).toBe('')
    expect(normalizeAuthReturnPath(`/${'x'.repeat(2050)}`)).toBe('')
  })
})
