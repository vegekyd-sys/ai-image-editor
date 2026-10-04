import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

describe('verified authentication completion coverage', () => {
  it('uses one completion endpoint for web, H5, and iOS login paths', () => {
    const login = source('src/app/login/page.tsx')

    expect(login).toContain("fetch('/api/auth/complete', { method: 'POST' })")
    expect(login).not.toContain("fetch('/api/auth/native-complete'")
    expect(login.match(/await completeAuthAndRedirect/g)?.length).toBeGreaterThanOrEqual(4)
    expect(login).toContain('signInWithPassword')
    expect(login).toContain('verifyOtp')
    expect(login).toContain('exchangeCodeForSession')
  })

  it('keeps older iOS builds on the same completion implementation', () => {
    expect(source('src/app/api/auth/native-complete/route.ts')).toContain(
      "export { POST } from '../complete/route'",
    )
  })

  it('completes only verified sessions and writes the activation cookie', () => {
    const completion = source('src/app/api/auth/complete/route.ts')

    expect(completion).toContain('user?.email_confirmed_at || user?.phone_confirmed_at')
    expect(completion).toContain("response.cookies.set('mkr_activated', '1'")
    expect(completion).toContain('initializeSignupCredits')
    expect(completion).toContain("'/home?trial=1'")
    expect(completion).toContain("eventName: 'CompleteRegistration'")
    expect(completion).not.toContain("eventName: 'StartTrial'")
  })

  it('removes the invite-era page and does not gate authenticated routes on its cookie', () => {
    const proxy = source('src/proxy.ts')

    expect(existsSync(path.join(root, 'src/app/activate/page.tsx'))).toBe(false)
    expect(proxy).not.toContain("request.cookies.get('mkr_activated')")
    expect(proxy).toContain('/api/auth/complete?next=')
  })

  it('keeps browser OAuth completion on the verified callback path', () => {
    const callback = source('src/app/api/auth/callback/route.ts')

    expect(callback).toContain('exchangeCodeForSession')
    expect(callback).toContain("response.cookies.set('mkr_activated', '1'")
    expect(callback).toContain('initializeSignupCredits')
    expect(callback).toContain("trialRequired ? 'trial' : 'welcome'")
  })
})
