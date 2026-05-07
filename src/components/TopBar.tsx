'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/lib/i18n'
import Changelog from '@/components/Changelog'

interface TopBarProps {
  page: 'home' | 'projects'
}

export default function TopBar({ page }: TopBarProps) {
  const { user, signOut } = useAuth()
  const { locale, setLocale } = useLocale()
  const router = useRouter()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    if (!user) return
    fetch('/api/billing/credits').then(r => r.json()).then(d => {
      setCreditBalance(d.balance ?? 0)
    }).catch(() => {})
  }, [user])

  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  return (
    <>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 10 }}>
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {page === 'home' && user && (
            <button
              onClick={() => router.push('/projects')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              {locale === 'zh' ? '我的项目' : 'My Projects'}
            </button>
          )}
          {page === 'projects' && (
            <button
              onClick={() => router.push('/home')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              {locale === 'zh' ? '探索' : 'Explore'}
            </button>
          )}
          <button
            onClick={() => setShowChangelog(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.45)',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            {locale === 'zh' ? '更新日志' : "What's new"}
          </button>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && creditBalance !== null && (
            <Link
              href="/dashboard"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                textDecoration: 'none',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={creditBalance < 20 ? '#fbbf24' : '#e879f9'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span style={{
                fontSize: '0.7rem', fontWeight: 600,
                color: creditBalance < 20 ? '#fbbf24' : 'rgba(255,255,255,0.5)',
              }}>
                {creditBalance.toLocaleString()}
              </span>
            </Link>
          )}
          {user ? (
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setUserMenuOpen(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: userMenuOpen ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => { if (!userMenuOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {userMenuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 8,
                  background: 'rgba(24,24,28,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: '4px 0', minWidth: 140,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
                }}>
                  <button
                    onClick={() => { setUserMenuOpen(false); router.push('/skills') }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px', background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Skills
                  </button>
                  <button
                    onClick={() => { setLocale(locale === 'zh' ? 'en' : 'zh') }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px', background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {locale === 'zh' ? 'English' : '中文'}
                  </button>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 8px' }} />
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut() }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px', background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => { setLocale(locale === 'zh' ? 'en' : 'zh') }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                {locale === 'zh' ? 'EN' : '中文'}
              </button>
              <button
                onClick={() => router.push('/login')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {locale === 'zh' ? '登录' : 'Sign in'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showChangelog && <Changelog onClose={() => setShowChangelog(false)} locale={locale} />}
    </>
  )
}
