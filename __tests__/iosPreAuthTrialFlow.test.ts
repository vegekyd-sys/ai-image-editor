import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearIOSPreAuthTrialContinuation,
  confirmIOSPreAuthTrialContinuation,
  linkIOSPreAuthTrialContinuation,
  readIOSPreAuthTrialContinuation,
  writeIOSPreAuthTrialIntent,
} from '@/lib/ios-preauth-trial'

const root = path.resolve(__dirname, '..')

describe('iOS subscription-before-registration flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('keeps the selected Skill intent until Apple confirms the trial', () => {
    writeIOSPreAuthTrialIntent({ kind: 'skill', skillId: 'stadium-selfie' })
    expect(readIOSPreAuthTrialContinuation()).toMatchObject({
      kind: 'skill',
      skillId: 'stadium-selfie',
      confirmed: false,
      linked: false,
    })

    expect(confirmIOSPreAuthTrialContinuation()).toMatchObject({
      kind: 'skill',
      skillId: 'stadium-selfie',
      confirmed: true,
      linked: false,
    })

    expect(linkIOSPreAuthTrialContinuation()).toMatchObject({
      confirmed: true,
      linked: true,
    })

    clearIOSPreAuthTrialContinuation()
    expect(readIOSPreAuthTrialContinuation()).toBeNull()
  })

  it('ships a private, expiring, one-transaction-one-account pending claim table', () => {
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260819073044_pending_apple_trial_claims.sql'),
      'utf8',
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS pending_apple_trial_claims')
    expect(migration).toContain('claim_token_hash text NOT NULL UNIQUE')
    expect(migration).toContain('apple_original_transaction_id text NOT NULL UNIQUE')
    expect(migration).toContain('apple_transaction_id text NOT NULL UNIQUE')
    expect(migration).toContain('claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE pending_apple_trial_claims FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT ALL ON TABLE pending_apple_trial_claims TO service_role')
  })

  it('replaces the iOS guest Skill uploader with the trial CTA and resumes in the editor', () => {
    const home = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8')
    const editorContainer = fs.readFileSync(path.join(root, 'src/components/ProjectEditorContainer.tsx'), 'utf8')
    const productsRoute = fs.readFileSync(path.join(root, 'src/app/api/billing/apple/products/route.ts'), 'utf8')
    const verifyRoute = fs.readFileSync(path.join(root, 'src/app/api/billing/apple/verify/route.ts'), 'utf8')
    const login = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8')

    expect(home).toContain('const isPreAuthIOSGuest = isIOSAppShell && !renderUser')
    expect(home).toContain("entryPoint=\"ios_preauth_trial\"")
    expect(home).toContain('!isPreAuthIOSSkillAction && renderUploadSlots(selectedDetail, true)')
    expect(home).toContain('confirmIOSPreAuthTrialContinuation()')
    expect(home).toContain("window.location.href = '/login?focus=email'")
    expect(home).toContain("fetch('/api/auth/complete', { method: 'POST' })")
    expect(home).toContain("t('home.continueRegistration')")
    expect(home).toContain('router.replace(`/projects/${result.projectId}`)')
    expect(editorContainer).toContain('pendingLaunch || pendingImages')
    expect(productsRoute).toContain('appAccountToken: user?.id')
    expect(productsRoute).not.toContain("return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })")
    expect(verifyRoute).toContain("body.intent !== 'preauth_trial'")
    expect(login).toContain('!complete.appleTrialClaimed')
    expect(login).toContain('emailRef.current?.focus')
  })
})
