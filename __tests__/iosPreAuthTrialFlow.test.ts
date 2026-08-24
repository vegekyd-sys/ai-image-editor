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

  it('stages iOS guest media before the trial and resumes the same Skill in the editor', () => {
    const home = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8')
    const creditPopup = fs.readFileSync(path.join(root, 'src/components/CreditPopup.tsx'), 'utf8')
    const editorContainer = fs.readFileSync(path.join(root, 'src/components/ProjectEditorContainer.tsx'), 'utf8')
    const productsRoute = fs.readFileSync(path.join(root, 'src/app/api/billing/apple/products/route.ts'), 'utf8')
    const verifyRoute = fs.readFileSync(path.join(root, 'src/app/api/billing/apple/verify/route.ts'), 'utf8')
    const login = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8')

    expect(home).toContain('const isPreAuthIOSGuest = isIOSAppShell && !renderUser')
    expect(home).toContain("entryPoint=\"ios_preauth_trial\"")
    expect(home).toContain('{renderUploadSlots(selectedDetail, true)}')
    expect(home).not.toContain('!isPreAuthIOSSkillAction && renderUploadSlots')
    expect(home).toContain('data-testid="skill-photo-slots"')
    expect(home).toContain('data-testid={`skill-photo-slot-${i}`}')
    expect(home).toContain('data-testid="skill-before-image"')
    expect(home).toContain('confirmIOSPreAuthTrialContinuation()')
    expect(home).toContain("router.push('/login?focus=email')")
    expect(home).toContain('handleCreateFilesSelected')
    expect(home).toContain('if (createInput.files.length > 0 || createInput.text.trim())')
    expect(home).toContain('if (trialContinuation?.confirmed && !trialContinuation.linked) return')
    expect(home).toContain('if (consumeDraftRef.current || getCreateDraftContinuationId()) return')
    expect(home).toContain('Subscription is complete, but an editor project must always have user')
    expect(home).toContain('router.replace(returnPath)')
    expect(home).not.toContain("throw new Error('Failed to create the post-trial project')")
    expect(home).toContain("fetch('/api/auth/complete', { method: 'POST' })")
    expect(home).toContain("t('home.continueRegistration')")
    expect(home).toContain('router.replace(`/projects/${result.projectId}`)')
    expect(editorContainer).toContain('pendingLaunch || pendingImages')
    expect(productsRoute).toContain('appAccountToken: user?.id')
    expect(productsRoute).not.toContain("return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })")
    expect(verifyRoute).toContain("body.intent !== 'preauth_trial'")
    expect(login).toContain('!complete.appleTrialClaimed')
    expect(login).toContain('router.replace(destination)')
    expect(login).toContain('emailRef.current?.focus')
    expect(creditPopup).toContain('await onPreAuthTrialConfirmed?.()')
    expect(creditPopup).toContain('isPreAuthTrial,')
    expect(creditPopup).toContain('restoreNativeApplePurchases(isPreAuthTrial)')
  })

  it('isolates StoreKit test configuration from the real-device App scheme', () => {
    const appScheme = fs.readFileSync(
      path.join(root, 'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme'),
      'utf8',
    )
    const e2eScheme = fs.readFileSync(
      path.join(root, 'ios/App/App.xcodeproj/xcshareddata/xcschemes/App-E2E.xcscheme'),
      'utf8',
    )
    const project = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')

    expect(appScheme).not.toContain('StoreKitConfigurationFileReference')
    expect(e2eScheme).toContain('StoreKitConfigurationFileReference')
    expect(e2eScheme).toContain('MakaronE2E.storekit')
    expect(project).not.toContain('D10E00000000000000000001 /* MakaronE2E.storekit in Resources */')
    expect(project).not.toContain('CODE_SIGN_ENTITLEMENTS = "App/App-E2E.entitlements"')

    const bridge = fs.readFileSync(path.join(root, 'ios/App/App/MakaronBridgeViewController.swift'), 'utf8')
    expect(bridge).toContain('introductoryOfferOnly')
    expect(bridge).toContain('isIntroductoryOffer(transaction)')
    expect(bridge).toContain('StoreKit skipped unfinished non-intro transaction')
  })
})
