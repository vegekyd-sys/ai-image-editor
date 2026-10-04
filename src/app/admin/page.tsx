'use client'

import CorePromptSwitch from '@/components/admin/CorePromptSwitch'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { navigateBackInIOSApp } from '@/lib/native-navigation'
import { LOCALE_CONFIG, type Locale } from '@/lib/locales'
import { useLocale } from '@/lib/i18n'
import { DEFAULT_WELCOME_CREDITS } from '@/lib/billing/welcome-credits'
import { DEFAULT_IOS_TRIAL_CREDITS } from '@/lib/billing/ios-trial'
import MediaPricingPanel from '@/components/admin/MediaPricingPanel'

interface CodexAllowlistUser {
  userId: string
  email: string | null
  isOwner: boolean
}

interface CreditPricing {
  tool_name: string
  supplier_cost: number
  credits: number
  is_free: boolean
  updated_at: string
}

interface TokenRateEntry {
  model_id: string
  display_name: string
  input_per_1m: number
  output_per_1m: number
  markup: number
  is_active: boolean
  updated_at: string
}

type LocalizedCopy = Record<Locale, string>

interface HomeSkillRecord {
  id: string
  labels?: Record<string, string>
  image?: string
  prompt?: string
  prompts?: Record<string, string>
  skill_path?: string | null
  image_count?: number
  sort_order?: number
  is_active?: boolean
  before_images?: string[]
  categories?: string[]
}

interface SkillCategoryRecord {
  id: string
  labels?: Record<string, string>
  descriptions?: Record<string, string>
  sort_order?: number
  icon?: string | null
  is_active?: boolean
}

function createLocalizedCopy(value: unknown, legacyEnglish = ''): LocalizedCopy {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return Object.fromEntries(LOCALE_CONFIG.map(({ code }) => {
    const localized = source[code]
    return [code, typeof localized === 'string' ? localized : code === 'en' ? legacyEnglish : '']
  })) as LocalizedCopy
}

function compactLocalizedCopy(value: LocalizedCopy): Record<string, string> {
  return Object.fromEntries(
    LOCALE_CONFIG
      .map(({ code }) => [code, value[code].trim()] as const)
      .filter(([, copy]) => copy.length > 0),
  )
}

function adminLabel(value: Record<string, string> | undefined, fallback: string): string {
  if (!value) return fallback
  return value.en || value.zh || value['zh-Hant'] || value.ja || fallback
}

interface MetaInsightsSummary {
  spend?: string
  impressions?: string
  clicks?: string
  cpc?: string
  ctr?: string
  actions?: { action_type: string; value: string }[]
}

interface MetaStatus {
  config: {
    apiVersion: string
    adAccountId?: string
    businessId?: string
    pageId?: string
    pixelId?: string
    appId?: string
    hasAccessToken: boolean
    hasCapiToken: boolean
    hasInstagramActorId: boolean
  }
  account: {
    id: string
    name?: string
    account_status?: number
    amount_spent?: string
    balance?: string
    currency?: string
    timezone_name?: string
  } | null
  pixels: {
    id: string
    name?: string
    last_fired_time?: string
    is_unavailable?: boolean
  }[]
  campaigns: {
    id: string
    name?: string
    status?: string
    effective_status?: string
    objective?: string
    daily_budget?: string
    lifetime_budget?: string
    created_time?: string
    updated_time?: string
  }[]
  insights: {
    yesterday: MetaInsightsSummary | null
    last7d: MetaInsightsSummary | null
  }
  fetchedAt: string
}

function fmtNumber(value?: string | number): string {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toLocaleString() : '0'
}

function fmtCurrency(value?: string | number, currency = 'USD'): string {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number.isFinite(n) ? n : 0)
}

function accountStatusLabel(status?: number): string {
  if (status === 1) return 'Active'
  if (status === 2) return 'Disabled'
  if (status === 3) return 'Unsettled'
  if (status === 7) return 'Pending review'
  if (status === 9) return 'In grace period'
  if (status === 100) return 'Pending closure'
  return status ? `Status ${status}` : 'Unknown'
}

function actionValue(insights: MetaInsightsSummary | null, actionType: string): string {
  return insights?.actions?.find(a => a.action_type === actionType)?.value ?? '0'
}

export default function AdminPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [tab, setTab] = useState<'codex' | 'billing' | 'skills' | 'meta'>('codex')
  const [codexAllowlist, setCodexAllowlist] = useState<CodexAllowlistUser[]>([])
  const [codexEmail, setCodexEmail] = useState('')
  const [codexSaving, setCodexSaving] = useState(false)
  const [planSync, setPlanSync] = useState<Record<'codex' | 'grok', 'synced' | 'pending' | 'unavailable' | 'checking'>>({ codex: 'checking', grok: 'checking' })
  const [codexMessage, setCodexMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pricing, setPricing] = useState<CreditPricing[]>([])
  const [editingPricing, setEditingPricing] = useState<Record<string, { credits?: string; supplier_cost?: string }>>({})
  const [tokenRates, setTokenRates] = useState<TokenRateEntry[]>([])
  const [editingRates, setEditingRates] = useState<Record<string, { input_per_1m?: string; output_per_1m?: string; markup?: string }>>({})
  const [newRate, setNewRate] = useState({ model_id: '', display_name: '', input_per_1m: '', output_per_1m: '', markup: '2.0' })
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [billingToggling, setBillingToggling] = useState(false)
  const [welcomeCredits, setWelcomeCredits] = useState(DEFAULT_WELCOME_CREDITS)
  const [editingWelcome, setEditingWelcome] = useState(false)
  const [welcomeInput, setWelcomeInput] = useState(String(DEFAULT_WELCOME_CREDITS))
  const [iosTrialCredits, setIOSTrialCredits] = useState(DEFAULT_IOS_TRIAL_CREDITS)
  const [editingIOSTrial, setEditingIOSTrial] = useState(false)
  const [iosTrialInput, setIOSTrialInput] = useState(String(DEFAULT_IOS_TRIAL_CREDITS))
  const [addCreditEmail, setAddCreditEmail] = useState('')
  const [addCreditAmount, setAddCreditAmount] = useState('100')
  const [addCreditResult, setAddCreditResult] = useState<string | null>(null)
  const [addingCredits, setAddingCredits] = useState(false)
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaError, setMetaError] = useState('')

  const [homeSkills, setHomeSkills] = useState<HomeSkillRecord[]>([])
  const [skillCategories, setSkillCategories] = useState<SkillCategoryRecord[]>([])
  const [modalSkill, setModalSkill] = useState<HomeSkillRecord | 'new' | null>(null)
  const [modalCategory, setModalCategory] = useState<SkillCategoryRecord | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchCodexAllowlist = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/personal-subscription-allowlist', { cache: 'no-store' })
      if (!res.ok) throw new Error('allowlist unavailable')
      const data = await res.json()
      if (Array.isArray(data.users)) setCodexAllowlist(data.users)
      setPlanSync(data.providers || { codex: 'unavailable', grok: 'unavailable' })
    } catch {
      setPlanSync({ codex: 'unavailable', grok: 'unavailable' })
      setCodexMessage({ type: 'error', text: t('admin.personalAllowlist.loadFailed') })
    }
  }, [t])

  const fetchPricing = useCallback(async () => {
    const res = await fetch('/api/admin/credit-pricing')
    if (res.status === 403) { setError('Not authorized'); return }
    const data = await res.json()
    if (Array.isArray(data)) setPricing(data)
  }, [])

  const fetchTokenRates = useCallback(async () => {
    const res = await fetch('/api/admin/token-rates')
    if (res.status === 403) return
    const data = await res.json()
    if (Array.isArray(data)) setTokenRates(data)
  }, [])

  const fetchHomeSkills = useCallback(async () => {
    const res = await fetch('/api/admin/home-skills')
    if (res.status === 403) return
    const data = await res.json()
    if (Array.isArray(data)) setHomeSkills(data)
  }, [])

  const fetchSkillCategories = useCallback(async () => {
    const res = await fetch('/api/admin/skill-categories')
    if (res.status === 403) return
    const data = await res.json()
    if (Array.isArray(data)) setSkillCategories(data)
  }, [])

  const fetchBillingToggle = useCallback(async () => {
    const res = await fetch('/api/admin/billing-toggle')
    if (res.status === 403) return
    const data = await res.json()
    setBillingEnabled(data.enabled ?? false)
    setWelcomeCredits(data.welcomeCredits ?? DEFAULT_WELCOME_CREDITS)
    setWelcomeInput(String(data.welcomeCredits ?? DEFAULT_WELCOME_CREDITS))
    setIOSTrialCredits(data.iosTrialCredits ?? DEFAULT_IOS_TRIAL_CREDITS)
    setIOSTrialInput(String(data.iosTrialCredits ?? DEFAULT_IOS_TRIAL_CREDITS))
  }, [])

  const fetchMetaStatus = useCallback(async () => {
    setMetaLoading(true)
    setMetaError('')
    try {
      const res = await fetch('/api/admin/meta/status')
      if (res.status === 403) { setError('Not authorized'); return }
      const data = await res.json()
      if (!res.ok) {
        setMetaError(data.error || 'Failed to load Meta status')
        setMetaStatus(null)
        return
      }
      setMetaStatus(data)
    } catch {
      setMetaError('Failed to load Meta status')
      setMetaStatus(null)
    } finally {
      setMetaLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchCodexAllowlist(), fetchPricing(), fetchTokenRates(), fetchBillingToggle(), fetchHomeSkills(), fetchSkillCategories(), fetchMetaStatus()]).finally(() => setLoading(false))
  }, [fetchCodexAllowlist, fetchPricing, fetchTokenRates, fetchBillingToggle, fetchHomeSkills, fetchSkillCategories, fetchMetaStatus])

  const mutatePersonalAllowlist = async (
    method: 'POST' | 'DELETE' | 'PUT',
    body: { email: string } | { userId: string } | undefined,
    success: 'added' | 'removed' | 'synchronized',
  ) => {
    if (codexSaving) return
    setCodexSaving(true)
    setCodexMessage(null)
    try {
      const res = await fetch('/api/admin/personal-subscription-allowlist', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (res.ok && Array.isArray(data.users)) {
        setCodexAllowlist(data.users)
        setPlanSync(data.providers || { codex: 'unavailable', grok: 'unavailable' })
        if (method === 'POST') setCodexEmail('')
        setCodexMessage({ type: 'success', text: t(`admin.personalAllowlist.${success}`) })
      } else {
        await fetchCodexAllowlist()
        setCodexMessage({ type: 'error', text: t(res.status === 404 ? 'admin.personalAllowlist.accountNotFound' : 'admin.personalAllowlist.updateFailed') })
      }
    } catch {
      await fetchCodexAllowlist()
      setCodexMessage({ type: 'error', text: t('admin.personalAllowlist.updateFailed') })
    } finally {
      setCodexSaving(false)
    }
  }

  const handleAddCodexAccount = async () => {
    if (codexEmail.trim()) await mutatePersonalAllowlist('POST', { email: codexEmail.trim() }, 'added')
  }

  const handleRemoveCodexAccount = (userId: string) => {
    return mutatePersonalAllowlist('DELETE', { userId }, 'removed')
  }

  const handleBackToApp = () => {
    if (navigateBackInIOSApp('/projects')) return
    router.push('/projects')
  }

  if (error) {
    return (
      <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black flex items-center justify-center text-red-400 text-lg">
        {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black text-white p-6">
      <div className={`mx-auto ${tab === 'billing' ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Admin</h1>
        <button type="button" onClick={handleBackToApp} className="text-white/40 text-sm hover:text-white/60">
          ← Back to app
        </button>
      </div>

      <CorePromptSwitch />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto bg-white/5 rounded-lg p-1" data-testid="admin-tabs">
        <button
          onClick={() => setTab('codex')}
          className={`shrink-0 whitespace-nowrap sm:flex-1 py-2 px-3 sm:px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'codex' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          {t('admin.personalAllowlist.tab')} ({codexAllowlist.length})
        </button>
        <button
          onClick={() => setTab('billing')}
          className={`shrink-0 whitespace-nowrap sm:flex-1 py-2 px-3 sm:px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'billing' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Billing ({pricing.length})
        </button>
        <button
          onClick={() => setTab('skills')}
          className={`shrink-0 whitespace-nowrap sm:flex-1 py-2 px-3 sm:px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'skills' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Skills ({homeSkills.length})
        </button>
        <button
          onClick={() => setTab('meta')}
          className={`shrink-0 whitespace-nowrap sm:flex-1 py-2 px-3 sm:px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'meta' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Meta Ads
        </button>
      </div>

      {/* ══════ CODEX SUBSCRIPTION ALLOWLIST TAB ══════ */}
      {tab === 'codex' && (
        <div className="space-y-4">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <h2 className="text-sm font-semibold">{t('admin.personalAllowlist.title')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/40">
              {t('admin.personalAllowlist.desc')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="personal-plan-sync">
              {(['codex', 'grok'] as const).map(provider => (
                <span key={provider} className={`rounded-full border px-2.5 py-1 text-xs ${planSync[provider] === 'synced' ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-400/20 text-amber-200'}`}>
                  {t(`admin.personalAllowlist.${provider}Status`, t(`admin.personalAllowlist.${planSync[provider]}`))}
                </span>
              ))}
              <button type="button" disabled={codexSaving} onClick={() => void mutatePersonalAllowlist('PUT', undefined, 'synchronized')}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40">
                {t('admin.personalAllowlist.sync')}
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={codexEmail}
                onChange={(event) => setCodexEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAddCodexAccount()
                }}
                placeholder={t('admin.personalAllowlist.emailPlaceholder')}
                aria-label={t('admin.personalAllowlist.emailPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-fuchsia-500/50"
              />
              <button
                type="button"
                onClick={handleAddCodexAccount}
                disabled={codexSaving || !codexEmail.trim()}
                className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {codexSaving ? t('admin.personalAllowlist.saving') : t('admin.personalAllowlist.add')}
              </button>
            </div>
            {codexMessage ? (
              <p className={`mt-3 text-xs ${codexMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`} role="status">
                {codexMessage.text}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            {codexAllowlist.map((user) => (
              <div key={user.userId} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{user.email || t('admin.personalAllowlist.unknownEmail')}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${user.isOwner ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                      {user.isOwner ? t('admin.personalAllowlist.owner') : t('admin.personalAllowlist.allowed')}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-white/25">{user.userId}</div>
                </div>
                {user.isOwner ? null : (
                  <button
                    type="button"
                    onClick={() => void handleRemoveCodexAccount(user.userId)}
                    disabled={codexSaving}
                    className="shrink-0 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-40"
                  >
                    {t('admin.personalAllowlist.remove')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════ BILLING TAB ══════ */}
      {tab === 'billing' && (
        <>
          {/* Billing master switch */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Billing</div>
              <div className="text-xs text-white/40 mt-0.5">
                {billingEnabled ? 'Active — users are charged for AI usage' : 'Off — all AI usage is free'}
              </div>
            </div>
            <button
              onClick={async () => {
                setBillingToggling(true)
                const next = !billingEnabled
                await fetch('/api/admin/billing-toggle', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: next }),
                })
                setBillingEnabled(next)
                setBillingToggling(false)
              }}
              disabled={billingToggling}
              className={`relative w-12 h-6 rounded-full transition-all ${billingEnabled ? 'bg-fuchsia-600' : 'bg-white/20'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${billingEnabled ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Welcome credits config */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Welcome Credits</div>
              <div className="text-xs text-white/40 mt-0.5">Granted to new users on activation</div>
            </div>
            <div className="flex items-center gap-2">
              {editingWelcome ? (
                <>
                  <input
                    type="number"
                    value={welcomeInput}
                    onChange={(e) => setWelcomeInput(e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-white/10 text-white text-sm text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      await fetch('/api/admin/billing-toggle', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ welcomeCredits: parseInt(welcomeInput) || DEFAULT_WELCOME_CREDITS }),
                      })
                      setWelcomeCredits(parseInt(welcomeInput) || DEFAULT_WELCOME_CREDITS)
                      setEditingWelcome(false)
                    }}
                    className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs"
                  >Save</button>
                  <button onClick={() => { setEditingWelcome(false); setWelcomeInput(String(welcomeCredits)); }} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">✕</button>
                </>
              ) : (
                <>
                  <span className="text-fuchsia-400 font-medium text-sm">{welcomeCredits}</span>
                  <button onClick={() => setEditingWelcome(true)} className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5">Edit</button>
                </>
              )}
            </div>
          </div>

          {/* iOS introductory trial credits config */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t('admin.iosTrialCredits')}</div>
              <div className="text-xs text-white/40 mt-0.5">{t('admin.iosTrialCreditsDesc')}</div>
            </div>
            <div className="flex items-center gap-2">
              {editingIOSTrial ? (
                <>
                  <input
                    type="number"
                    min="0"
                    value={iosTrialInput}
                    onChange={(e) => setIOSTrialInput(e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-white/10 text-white text-sm text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      const next = Number.isFinite(Number(iosTrialInput)) && Number(iosTrialInput) >= 0
                        ? Math.floor(Number(iosTrialInput))
                        : DEFAULT_IOS_TRIAL_CREDITS
                      await fetch('/api/admin/billing-toggle', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ iosTrialCredits: next }),
                      })
                      setIOSTrialCredits(next)
                      setIOSTrialInput(String(next))
                      setEditingIOSTrial(false)
                    }}
                    className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs"
                  >{t('admin.save')}</button>
                  <button onClick={() => { setEditingIOSTrial(false); setIOSTrialInput(String(iosTrialCredits)); }} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">✕</button>
                </>
              ) : (
                <>
                  <span className="text-fuchsia-400 font-medium text-sm">{iosTrialCredits}</span>
                  <button onClick={() => setEditingIOSTrial(true)} className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5">{t('admin.edit')}</button>
                </>
              )}
            </div>
          </div>

          {/* Add credits to user */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
            <div className="text-sm font-medium mb-3">Add Credits to User</div>
            <div className="flex gap-2">
              <input
                type="email"
                value={addCreditEmail}
                onChange={(e) => setAddCreditEmail(e.target.value)}
                placeholder="user@email.com"
                className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <input
                type="number"
                value={addCreditAmount}
                onChange={(e) => setAddCreditAmount(e.target.value)}
                className="w-20 px-2 py-1.5 rounded-lg bg-white/10 text-white text-xs text-right border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <button
                onClick={async () => {
                  if (!addCreditEmail || !addCreditAmount) return
                  setAddingCredits(true)
                  setAddCreditResult(null)
                  try {
                    const res = await fetch('/api/admin/add-credits', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: addCreditEmail, credits: parseInt(addCreditAmount) }),
                    })
                    const data = await res.json()
                    if (data.success) {
                      setAddCreditResult(`Added ${data.credits} → balance: ${data.newBalance}`)
                      setAddCreditEmail('')
                    } else {
                      setAddCreditResult(`Error: ${data.error}`)
                    }
                  } catch { setAddCreditResult('Failed') }
                  finally { setAddingCredits(false) }
                }}
                disabled={addingCredits || !addCreditEmail}
                className="px-4 py-1.5 rounded-lg bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
              >
                {addingCredits ? '...' : 'Add'}
              </button>
            </div>
            {addCreditResult && (
              <div className={`text-xs mt-2 ${addCreditResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                {addCreditResult}
              </div>
            )}
          </div>

          <MediaPricingPanel />
          <h3 className="text-sm font-medium text-white/60 mb-3">{t('mediaPricing.fixedTitle')}</h3>
          <p className="text-xs text-white/30 mb-3">{t('mediaPricing.fixedDescription')}</p>

          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Tool</th>
                  <th className="text-right px-4 py-3 font-medium">Supplier $</th>
                  <th className="text-right px-4 py-3 font-medium">Credits</th>
                  <th className="text-center px-4 py-3 font-medium">Unit</th>
                  <th className="text-right px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {pricing.filter(p => !['create_video_kling', 'edit_video_kling', 'create_video_seedance', 'create_music', 'create_seed_audio', 'create_voiceover'].includes(p.tool_name)).map((p) => {
                  const editing = editingPricing[p.tool_name]
                  const isVideo = p.tool_name.includes('video') && !p.tool_name.includes('status')
                  return (
                    <tr key={p.tool_name} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs">{p.tool_name}</td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.0001"
                            value={editing.supplier_cost ?? String(p.supplier_cost)}
                            onChange={(e) => setEditingPricing(prev => ({
                              ...prev,
                              [p.tool_name]: { ...prev[p.tool_name], supplier_cost: e.target.value }
                            }))}
                            className="w-24 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/60">${Number(p.supplier_cost).toFixed(4)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            value={editing.credits ?? String(p.credits)}
                            onChange={(e) => setEditingPricing(prev => ({
                              ...prev,
                              [p.tool_name]: { ...prev[p.tool_name], credits: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className={p.is_free ? 'text-white/30' : 'text-fuchsia-400 font-medium'}>{p.credits}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs text-white/30">
                          {p.is_free ? 'free' : isVideo ? '/sec' : '/task'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={async () => {
                                await fetch('/api/admin/credit-pricing', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    tool_name: p.tool_name,
                                    ...(editing.supplier_cost !== undefined ? { supplier_cost: parseFloat(editing.supplier_cost) } : {}),
                                    ...(editing.credits !== undefined ? { credits: parseInt(editing.credits) } : {}),
                                  }),
                                })
                                setEditingPricing(prev => { const n = { ...prev }; delete n[p.tool_name]; return n })
                                fetchPricing()
                              }}
                              className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs hover:bg-fuchsia-500"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingPricing(prev => { const n = { ...prev }; delete n[p.tool_name]; return n })}
                              className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs hover:text-white/70"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingPricing(prev => ({ ...prev, [p.tool_name]: {} }))}
                            className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pricing.length === 0 && (
            <p className="text-white/30 text-sm text-center py-8">No pricing entries</p>
          )}

          {/* ── Token Rates ── */}
          <h3 className="text-sm font-medium text-white/60 mt-8 mb-3">Token Rates (per-token billing)</h3>

          {/* Add new rate */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
            <div className="grid grid-cols-5 gap-2">
              <input
                type="text"
                value={newRate.model_id}
                onChange={(e) => setNewRate(prev => ({ ...prev, model_id: e.target.value }))}
                placeholder="model_id"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none font-mono"
              />
              <input
                type="text"
                value={newRate.display_name}
                onChange={(e) => setNewRate(prev => ({ ...prev, display_name: e.target.value }))}
                placeholder="Display Name"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                value={newRate.input_per_1m}
                onChange={(e) => setNewRate(prev => ({ ...prev, input_per_1m: e.target.value }))}
                placeholder="In $/1M"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none text-right"
              />
              <input
                type="number"
                step="0.01"
                value={newRate.output_per_1m}
                onChange={(e) => setNewRate(prev => ({ ...prev, output_per_1m: e.target.value }))}
                placeholder="Out $/1M"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none text-right"
              />
              <button
                onClick={async () => {
                  if (!newRate.model_id || !newRate.display_name) return
                  await fetch('/api/admin/token-rates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model_id: newRate.model_id,
                      display_name: newRate.display_name,
                      input_per_1m: parseFloat(newRate.input_per_1m) || 0,
                      output_per_1m: parseFloat(newRate.output_per_1m) || 0,
                      markup: parseFloat(newRate.markup) || 2.0,
                    }),
                  })
                  setNewRate({ model_id: '', display_name: '', input_per_1m: '', output_per_1m: '', markup: '2.0' })
                  fetchTokenRates()
                }}
                disabled={!newRate.model_id || !newRate.display_name}
                className="px-3 py-1.5 rounded bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Model</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-right px-4 py-3 font-medium">In $/1M</th>
                  <th className="text-right px-4 py-3 font-medium">Out $/1M</th>
                  <th className="text-right px-4 py-3 font-medium">Markup</th>
                  <th className="text-right px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {tokenRates.map((r) => {
                  const editing = editingRates[r.model_id]
                  return (
                    <tr key={r.model_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate" title={r.model_id}>
                        {r.model_id}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60">{r.display_name}</td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editing.input_per_1m ?? String(r.input_per_1m)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], input_per_1m: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/60">${Number(r.input_per_1m).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editing.output_per_1m ?? String(r.output_per_1m)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], output_per_1m: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-fuchsia-400 font-medium">${Number(r.output_per_1m).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.1"
                            value={editing.markup ?? String(r.markup)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], markup: e.target.value }
                            }))}
                            className="w-16 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/40">{Number(r.markup).toFixed(1)}x</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={async () => {
                                await fetch('/api/admin/token-rates', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    model_id: r.model_id,
                                    ...(editing.input_per_1m !== undefined ? { input_per_1m: parseFloat(editing.input_per_1m) } : {}),
                                    ...(editing.output_per_1m !== undefined ? { output_per_1m: parseFloat(editing.output_per_1m) } : {}),
                                    ...(editing.markup !== undefined ? { markup: parseFloat(editing.markup) } : {}),
                                  }),
                                })
                                setEditingRates(prev => { const n = { ...prev }; delete n[r.model_id]; return n })
                                fetchTokenRates()
                              }}
                              className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs hover:bg-fuchsia-500"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRates(prev => { const n = { ...prev }; delete n[r.model_id]; return n })}
                              className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs hover:text-white/70"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingRates(prev => ({ ...prev, [r.model_id]: {} }))}
                            className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {tokenRates.length === 0 && (
            <p className="text-white/30 text-sm text-center py-4">No token rates configured</p>
          )}
        </>
      )}

      {/* ══════ META ADS TAB ══════ */}
      {tab === 'meta' && (
        <div className="space-y-4">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Meta Ads Readiness</div>
              <div className="text-xs text-white/40 mt-0.5">
                Read-only account, Pixel, campaign, and spend checks. No ads are created here.
              </div>
              {metaStatus?.fetchedAt && (
                <div className="text-[11px] text-white/25 mt-1">Updated {new Date(metaStatus.fetchedAt).toLocaleString()}</div>
              )}
            </div>
            <button
              onClick={fetchMetaStatus}
              disabled={metaLoading}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-medium hover:bg-white/15 disabled:opacity-40"
            >
              {metaLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {metaError && (
            <div className="bg-red-500/10 border border-red-400/20 rounded-xl p-4 text-sm text-red-300">
              {metaError}
            </div>
          )}

          {metaStatus && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-white/40">Ad account</div>
                  <div className="mt-2 text-sm font-medium">{metaStatus.account?.name || 'Unknown'}</div>
                  <div className="mt-1 text-xs text-green-400">{accountStatusLabel(metaStatus.account?.account_status)}</div>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-white/40">Yesterday spend</div>
                  <div className="mt-2 text-xl font-semibold">{fmtCurrency(metaStatus.insights.yesterday?.spend, metaStatus.account?.currency)}</div>
                  <div className="mt-1 text-xs text-white/30">{fmtNumber(metaStatus.insights.yesterday?.clicks)} clicks</div>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-white/40">Last 7 days spend</div>
                  <div className="mt-2 text-xl font-semibold">{fmtCurrency(metaStatus.insights.last7d?.spend, metaStatus.account?.currency)}</div>
                  <div className="mt-1 text-xs text-white/30">{fmtNumber(metaStatus.insights.last7d?.impressions)} impressions</div>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-white/40">Campaigns</div>
                  <div className="mt-2 text-xl font-semibold">{metaStatus.campaigns.length}</div>
                  <div className="mt-1 text-xs text-white/30">{metaStatus.campaigns.filter(c => c.effective_status === 'ACTIVE').length} active</div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-3">Tracking</div>
                  <div className="space-y-2">
                    {metaStatus.pixels.map(pixel => (
                      <div key={pixel.id} className="rounded-lg bg-black/20 border border-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm">{pixel.name || pixel.id}</div>
                            <div className="text-xs text-white/35 font-mono mt-0.5">{pixel.id}</div>
                          </div>
                          <span className={pixel.is_unavailable ? 'text-red-400 text-xs' : 'text-green-400 text-xs'}>
                            {pixel.is_unavailable ? 'Unavailable' : 'Available'}
                          </span>
                        </div>
                        <div className="text-xs text-white/35 mt-2">
                          Last fired: {pixel.last_fired_time ? new Date(pixel.last_fired_time).toLocaleString() : 'No recent event'}
                        </div>
                      </div>
                    ))}
                    {metaStatus.pixels.length === 0 && <div className="text-sm text-white/30">No pixels found on this ad account.</div>}
                  </div>
                </div>

                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                  <div className="text-sm font-medium mb-3">API Config</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <span className="text-white/35">API version</span><span>{metaStatus.config.apiVersion}</span>
                    <span className="text-white/35">Ad account</span><span className="font-mono">{metaStatus.config.adAccountId}</span>
                    <span className="text-white/35">Business</span><span className="font-mono">{metaStatus.config.businessId || '—'}</span>
                    <span className="text-white/35">Page</span><span className="font-mono">{metaStatus.config.pageId || '—'}</span>
                    <span className="text-white/35">Pixel</span><span className="font-mono">{metaStatus.config.pixelId || '—'}</span>
                    <span className="text-white/35">Access token</span><span className={metaStatus.config.hasAccessToken ? 'text-green-400' : 'text-red-400'}>{metaStatus.config.hasAccessToken ? 'Configured' : 'Missing'}</span>
                    <span className="text-white/35">CAPI token</span><span className={metaStatus.config.hasCapiToken ? 'text-green-400' : 'text-red-400'}>{metaStatus.config.hasCapiToken ? 'Configured' : 'Missing'}</span>
                    <span className="text-white/35">Instagram actor</span><span className={metaStatus.config.hasInstagramActorId ? 'text-green-400' : 'text-amber-300'}>{metaStatus.config.hasInstagramActorId ? 'Configured' : 'Missing'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                <div className="text-sm font-medium mb-3">Account Insights</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  {([
                    ['Spend', fmtCurrency(metaStatus.insights.last7d?.spend, metaStatus.account?.currency)],
                    ['Impressions', fmtNumber(metaStatus.insights.last7d?.impressions)],
                    ['Clicks', fmtNumber(metaStatus.insights.last7d?.clicks)],
                    ['CTR', `${Number(metaStatus.insights.last7d?.ctr ?? 0).toFixed(2)}%`],
                    ['CPC', fmtCurrency(metaStatus.insights.last7d?.cpc, metaStatus.account?.currency)],
                    ['Purchases', actionValue(metaStatus.insights.last7d, 'purchase')],
                    ['Subscribes', actionValue(metaStatus.insights.last7d, 'subscribe')],
                    ['Checkouts', actionValue(metaStatus.insights.last7d, 'initiate_checkout')],
                    ['Registrations', actionValue(metaStatus.insights.last7d, 'complete_registration')],
                    ['Customizes', actionValue(metaStatus.insights.last7d, 'customize_product')],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-black/20 border border-white/5 p-3">
                      <div className="text-xs text-white/35">{label}</div>
                      <div className="mt-1 font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-medium">Campaigns</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs border-b border-white/10">
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium">Objective</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-right px-4 py-3 font-medium">Budget</th>
                      <th className="text-right px-4 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metaStatus.campaigns.map(campaign => (
                      <tr key={campaign.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <div>{campaign.name || campaign.id}</div>
                          <div className="font-mono text-[11px] text-white/25 mt-0.5">{campaign.id}</div>
                        </td>
                        <td className="px-4 py-3 text-white/55 text-xs">{campaign.objective || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={campaign.effective_status === 'ACTIVE' ? 'text-green-400 text-xs' : 'text-white/45 text-xs'}>
                            {campaign.effective_status || campaign.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-white/55 text-xs">
                          {campaign.daily_budget ? `Daily ${campaign.daily_budget}` : campaign.lifetime_budget ? `Lifetime ${campaign.lifetime_budget}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-white/35 text-xs">
                          {campaign.updated_time ? new Date(campaign.updated_time).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {metaStatus.campaigns.length === 0 && (
                  <div className="text-white/30 text-sm text-center py-8">No campaigns yet. Next step is creating paused draft campaigns.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ SKILLS TAB ══════ */}
      {tab === 'skills' && (
        <>
          <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-white/80">Categories</h3>
                <p className="mt-0.5 text-xs text-white/35">A skill can appear in more than one category.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalCategory('new')}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white/80"
              >+ Category</button>
            </div>
            {skillCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {skillCategories.map(category => (
                  <div
                    key={category.id}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${category.is_active === false ? 'border-white/5 bg-black/20 text-white/30' : 'border-white/10 bg-white/[0.035] text-white/70'}`}
                  >
                    {category.icon && <span aria-hidden>{category.icon}</span>}
                    <span className="text-xs font-medium">{adminLabel(category.labels, category.id)}</span>
                    <span className="text-[10px] text-white/25">{category.id}</span>
                    <button
                      type="button"
                      onClick={() => setModalCategory(category)}
                      className="ml-1 text-[11px] text-white/35 hover:text-white/70"
                    >Edit</button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Delete category “${adminLabel(category.labels, category.id)}”?`)) return
                        const res = await fetch('/api/admin/skill-categories', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: category.id }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) {
                          alert(data.error || 'Failed to delete category')
                          return
                        }
                        setSkillCategories(prev => prev.filter(item => item.id !== category.id))
                      }}
                      className="text-[11px] text-red-400/35 hover:text-red-400/80"
                    >Delete</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/30">
                No categories yet.
              </div>
            )}
          </div>

          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-white/35">{homeSkills.length} skills</div>
            <button
              type="button"
              onClick={() => setModalSkill('new')}
              className="px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-500"
            >+ Add Skill</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Cover</th>
                  <th className="text-left py-2 px-2">Labels</th>
                  <th className="text-left py-2 px-2">Categories</th>
                  <th className="text-left py-2 px-2">Skill</th>
                  <th className="text-center py-2 px-2">Active</th>
                  <th className="text-right py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {homeSkills.map((skill) => (
                  <tr key={skill.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-2 text-white/40">{skill.sort_order}</td>
                    <td className="py-2 px-2">
                      {skill.image && (

                        <img src={skill.image} alt="" style={{ maxHeight: 48, maxWidth: 64, objectFit: 'contain', borderRadius: 4 }} />
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="text-white">{skill.labels?.en || skill.labels?.zh || '—'}</div>
                      {skill.labels?.zh && <div className="text-white/40 text-xs">{skill.labels.zh}</div>}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex max-w-48 flex-wrap gap-1">
                        {(skill.categories || []).length > 0 ? skill.categories?.map(categoryId => {
                          const category = skillCategories.find(item => item.id === categoryId)
                          return (
                            <span key={categoryId} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/45">
                              {adminLabel(category?.labels, categoryId)}
                            </span>
                          )
                        }) : <span className="text-white/20">—</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      {skill.skill_path ? (
                        <span className="text-green-400 text-xs">✓</span>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={async () => {
                          const next = !skill.is_active
                          await fetch('/api/admin/home-skills', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: skill.id, is_active: next }),
                          })
                          setHomeSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_active: next } : s))
                        }}
                        className={`w-8 h-4 rounded-full transition-all relative ${skill.is_active ? 'bg-fuchsia-600' : 'bg-white/20'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${skill.is_active ? 'left-4' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setModalSkill(skill)} className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5">Edit</button>
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this skill?')) return
                            await fetch('/api/admin/home-skills', {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: skill.id }),
                            })
                            setHomeSkills(prev => prev.filter(s => s.id !== skill.id))
                          }}
                          className="px-2 py-1 rounded text-red-400/50 text-xs hover:text-red-400 hover:bg-red-400/10"
                        >Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

        {modalSkill && (
          <SkillEditorModal
            skill={modalSkill === 'new' ? null : modalSkill}
            categories={skillCategories}
            onClose={() => setModalSkill(null)}
            onSaved={() => { setModalSkill(null); fetchHomeSkills() }}
          />
        )}
        {modalCategory && (
          <CategoryEditorModal
            category={modalCategory === 'new' ? null : modalCategory}
            onClose={() => setModalCategory(null)}
            onSaved={() => { setModalCategory(null); fetchSkillCategories() }}
          />
        )}
      </div>
    </div>
  )
}

function LocalizedFields({
  title,
  values,
  onChange,
  multiline = false,
  placeholder,
}: {
  title: string
  values: LocalizedCopy
  onChange: (locale: Locale, value: string) => void
  multiline?: boolean
  placeholder: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-white/60">{title}</label>
      <div className="space-y-2">
        {LOCALE_CONFIG.map(locale => (
          <div key={locale.code} className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2">
            <div className="pt-2">
              <div className="text-xs font-medium text-white/55">{locale.shortLabel}</div>
              <div className="text-[10px] text-white/25">{locale.code}</div>
            </div>
            {multiline ? (
              <textarea
                value={values[locale.code]}
                onChange={event => onChange(locale.code, event.target.value)}
                rows={3}
                placeholder={`${placeholder} · ${locale.label}`}
                className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 focus:border-fuchsia-500/50 focus:outline-none"
              />
            ) : (
              <input
                value={values[locale.code]}
                onChange={event => onChange(locale.code, event.target.value)}
                placeholder={`${placeholder} · ${locale.label}`}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 focus:border-fuchsia-500/50 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-white/25">Empty locales use the product fallback chain.</p>
    </div>
  )
}

function SkillEditorModal({ skill, categories, onClose, onSaved }: {
  skill: HomeSkillRecord | null
  categories: SkillCategoryRecord[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !skill
  const [labels, setLabels] = useState<LocalizedCopy>(() => createLocalizedCopy(skill?.labels))
  const [prompts, setPrompts] = useState<LocalizedCopy>(() => createLocalizedCopy(skill?.prompts, skill?.prompt ?? ''))
  const [image, setImage] = useState<string>(skill?.image ?? '')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(skill?.categories ?? [])
  const [skillPath, setSkillPath] = useState<string>(skill?.skill_path ?? '')
  const [imageCount, setImageCount] = useState<string>(String(skill?.image_count ?? 1))
  const [sortOrder, setSortOrder] = useState<string>(String(skill?.sort_order ?? 0))
  const [isActive, setIsActive] = useState<boolean>(skill?.is_active ?? true)
  const [beforeImages, setBeforeImages] = useState<string[]>(
    Array.isArray(skill?.before_images) ? skill.before_images : []
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const hasCompleteLocalizedCopy = Object.values(labels).every(value => value.trim())
    && Object.values(prompts).every(value => value.trim())
  const canSave = image.trim() !== ''
    && (isNew ? hasCompleteLocalizedCopy && selectedCategories.length > 0 : Object.values(labels).some(value => value.trim()))

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const labelsObj = compactLocalizedCopy(labels)
      const promptsObj = compactLocalizedCopy(prompts)
      const legacyPrompt = promptsObj.en || promptsObj.zh || promptsObj['zh-Hant'] || promptsObj.ja || ''
      const payload = {
        labels: labelsObj,
        image: image.trim(),
        prompts: promptsObj,
        prompt: legacyPrompt,
        categories: selectedCategories,
        skill_path: skillPath.trim() || null,
        image_count: Number.isFinite(Number.parseInt(imageCount, 10))
          ? Math.max(0, Number.parseInt(imageCount, 10))
          : 1,
        sort_order: parseInt(sortOrder) || 0,
        is_active: isActive,
        before_images: beforeImages.map(s => s.trim()).filter(Boolean),
      }
      const res = await fetch('/api/admin/home-skills', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? payload : { id: skill.id, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) onSaved()
      else setSaveError(data.error || 'Failed to save skill')
    } catch {
      setSaveError('Failed to reach the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#18181c] border border-white/10 rounded-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h3 className="text-white text-base font-semibold">{isNew ? 'New Skill' : 'Edit Skill'}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-5 flex-1">
          {/* Cover image */}
          <div>
            <label className="text-white/60 text-xs font-medium mb-1.5 block">Cover image</label>
            <div className="flex items-start gap-3">
              <div className="w-20 h-16 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                {image.trim() ? (

                  <img src={image} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                ) : (
                  <span className="text-white/20 text-xs">preview</span>
                )}
              </div>
              <input
                type="url"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://..."
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 text-white text-sm placeholder-white/20 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
          </div>

          <LocalizedFields
            title="Skill title"
            values={labels}
            onChange={(locale, value) => setLabels(previous => ({ ...previous, [locale]: value }))}
            placeholder="Title"
          />

          <LocalizedFields
            title="Default prompt"
            values={prompts}
            onChange={(locale, value) => setPrompts(previous => ({ ...previous, [locale]: value }))}
            placeholder="Prompt"
            multiline
          />

          {isNew && !hasCompleteLocalizedCopy && (
            <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/65">
              New skills require titles and default prompts in all four locales.
            </div>
          )}

          {/* Categories */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/60">Categories</label>
            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {categories.map(category => {
                  const checked = selectedCategories.includes(category.id)
                  return (
                    <label
                      key={category.id}
                      className={`flex cursor-pointer select-none items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${checked ? 'border-fuchsia-400/35 bg-fuchsia-400/10 text-fuchsia-200' : 'border-white/10 bg-white/[0.025] text-white/50 hover:bg-white/5'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={event => setSelectedCategories(previous => event.target.checked
                          ? [...new Set([...previous, category.id])]
                          : previous.filter(id => id !== category.id))}
                        className="accent-fuchsia-500"
                      />
                      {category.icon && <span aria-hidden>{category.icon}</span>}
                      <span>{adminLabel(category.labels, category.id)}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-white/30">
                Create a category first, then assign this skill.
              </div>
            )}
            {selectedCategories.filter(id => !categories.some(category => category.id === id)).map(id => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedCategories(previous => previous.filter(categoryId => categoryId !== id))}
                className="mt-2 mr-2 rounded-md border border-amber-400/20 px-2 py-1 text-[11px] text-amber-300/60"
              >Remove missing category: {id}</button>
            ))}
            {isNew && selectedCategories.length === 0 && (
              <div className="mt-2 text-xs text-amber-200/55">Choose at least one category.</div>
            )}
          </div>

          {/* Skill zip */}
          <div>
            <label className="text-white/60 text-xs font-medium mb-1.5 block">Skill zip URL</label>
            <input
              type="url"
              value={skillPath}
              onChange={(e) => setSkillPath(e.target.value)}
              placeholder="https://... .zip (leave empty for prompt-only)"
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-white text-sm placeholder-white/20 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
            />
          </div>

          {/* Before images */}
          <div>
            <label className="text-white/60 text-xs font-medium mb-1.5 block">Example (before) images — 1 to 3</label>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                    {beforeImages[i]?.trim() ? (

                      <img src={beforeImages[i]} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span className="text-white/20 text-xs">{i + 1}</span>
                    )}
                  </div>
                  <input
                    type="url"
                    value={beforeImages[i] ?? ''}
                    onChange={(e) => {
                      const next = [...beforeImages]
                      next[i] = e.target.value
                      setBeforeImages(next)
                    }}
                    placeholder={`Before image ${i + 1} URL (optional)`}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 text-white text-sm placeholder-white/20 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Numbers */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-white/60 text-xs font-medium mb-1.5 block">Image slots</label>
              <input
                type="number" min={0} max={10}
                value={imageCount}
                onChange={(e) => setImageCount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 text-white text-sm border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-white/60 text-xs font-medium mb-1.5 block">Sort order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 text-white text-sm border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Active */}
          <div className="flex items-center justify-between">
            <label className="text-white/60 text-xs font-medium">Active (visible on home)</label>
            <button
              onClick={() => setIsActive(v => !v)}
              className={`w-10 h-5 rounded-full transition-all relative ${isActive ? 'bg-fuchsia-600' : 'bg-white/20'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isActive ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <div className="text-xs text-red-300/80">{saveError}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-white/60 text-sm hover:bg-white/5">Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-30 disabled:cursor-not-allowed"
            >{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CategoryEditorModal({ category, onClose, onSaved }: {
  category: SkillCategoryRecord | null
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !category
  const [id, setId] = useState(category?.id ?? '')
  const [labels, setLabels] = useState<LocalizedCopy>(() => createLocalizedCopy(category?.labels))
  const [descriptions, setDescriptions] = useState<LocalizedCopy>(() => createLocalizedCopy(category?.descriptions))
  const [icon, setIcon] = useState(category?.icon ?? '')
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const normalizedId = id.trim().toLowerCase()
  const idIsValid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(normalizedId) && normalizedId !== 'all'
  const canSave = idIsValid && Object.values(labels).some(value => value.trim())

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/admin/skill-categories', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: normalizedId,
          labels: compactLocalizedCopy(labels),
          descriptions: compactLocalizedCopy(descriptions),
          icon: icon.trim() || null,
          sort_order: Number.parseInt(sortOrder, 10) || 0,
          is_active: isActive,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) onSaved()
      else setSaveError(data.error || 'Failed to save category')
    } catch {
      setSaveError('Failed to reach the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col rounded-2xl border border-white/10 bg-[#18181c]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">{isNew ? 'New Category' : 'Edit Category'}</h3>
            <p className="mt-0.5 text-xs text-white/30">Category copy follows the same four product locales.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/70">✕</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">ID</label>
              <input
                value={id}
                disabled={!isNew}
                onChange={event => setId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="portrait"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 focus:border-fuchsia-500/50 focus:outline-none disabled:opacity-40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Icon</label>
              <input
                value={icon}
                onChange={event => setIcon(event.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={event => setSortOrder(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>
          </div>
          {!idIsValid && id.length > 0 && (
            <div className="text-xs text-amber-300/60">Use lowercase letters, numbers, and hyphens. “all” is reserved.</div>
          )}

          <LocalizedFields
            title="Category title"
            values={labels}
            onChange={(locale, value) => setLabels(previous => ({ ...previous, [locale]: value }))}
            placeholder="Title"
          />

          <LocalizedFields
            title="Category description (optional)"
            values={descriptions}
            onChange={(locale, value) => setDescriptions(previous => ({ ...previous, [locale]: value }))}
            placeholder="Short description"
          />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-white/60">Active</div>
              <div className="mt-0.5 text-[11px] text-white/25">Inactive categories stay editable but are hidden from the home feed.</div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(value => !value)}
              className={`relative h-5 w-10 rounded-full transition-all ${isActive ? 'bg-fuchsia-600' : 'bg-white/20'}`}
            >
              <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isActive ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <div className="text-xs text-red-300/80">{saveError}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:bg-white/5">Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-30"
            >{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
