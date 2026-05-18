'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/lib/i18n'
import { createBrowserClient } from '@supabase/ssr'
import { getThumbnailUrl } from '@/lib/supabase/storage'

export default function ProfilePage() {
  const { user, loading, signOut } = useAuth()
  const { locale } = useLocale()
  const t = locale === 'zh'

  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isOAuth = user?.app_metadata?.provider === 'google'

  useEffect(() => {
    if (user) {
      setDisplayName(user.user_metadata?.full_name || user.user_metadata?.name || '')
      setAvatarUrl(user.user_metadata?.avatar_url || null)
    }
  }, [user])

  if (loading) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (!user) return null

  const initials = (user.email || '?')[0].toUpperCase()

  const handleSaveName = async () => {
    setSavingName(true)
    setNameSuccess(false)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error } = await supabase.auth.updateUser({
      data: { full_name: displayName },
    })
    setSavingName(false)
    if (!error) setNameSuccess(true)
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess(false)
    if (newPassword !== confirmPassword) {
      setPasswordError(t ? '两次密码不一致' : 'Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError(t ? '密码至少 6 位' : 'Password must be at least 6 characters')
      return
    }
    setSavingPassword(true)
    const res = await fetch('/api/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    const data = await res.json()
    setSavingPassword(false)
    if (!res.ok) {
      setPasswordError(data.error === 'Current password is incorrect'
        ? (t ? '当前密码错误' : 'Current password is incorrect')
        : data.error)
    } else {
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const refreshSession = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.refreshSession()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await fetch('/api/profile/avatar', { method: 'POST', body: formData })
    const data = await res.json()
    setUploadingAvatar(false)
    if (res.ok && data.avatar_url) {
      setAvatarUrl(data.avatar_url)
      await refreshSession()
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'white', fontSize: '0.85rem', outline: 'none',
  }

  return (
    <div className="min-h-dvh bg-black text-white p-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">{t ? '账户' : 'Account'}</h1>
        <Link href="/projects" className="text-white/40 text-sm hover:text-white/60">
          &larr; {t ? '返回' : 'Back'}
        </Link>
      </div>

      {/* Avatar + Name */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative w-16 h-16 rounded-full overflow-hidden shrink-0 border-2 border-white/10 hover:border-fuchsia-500/50 transition-all cursor-pointer"
        >
          {avatarUrl ? (
            <img src={getThumbnailUrl(avatarUrl, 128, 80, 128, 'cover')} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-fuchsia-600 flex items-center justify-center text-xl font-bold">
              {initials}
            </div>
          )}
          {uploadingAvatar && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[0.55rem] text-center py-0.5 text-white/70">
            {t ? '修改' : 'Edit'}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          className="hidden"
        />
        <div>
          <div className="text-white font-medium">{displayName || user.email}</div>
          <div className="text-white/40 text-sm">{user.email}</div>
        </div>
      </div>

      {/* Display Name */}
      <section className="mb-8">
        <label className="block text-white/50 text-xs uppercase tracking-wider mb-2">
          {t ? '显示名称' : 'Display Name'}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={displayName}
            onChange={e => { setDisplayName(e.target.value); setNameSuccess(false) }}
            style={inputStyle}
            placeholder={t ? '输入名称' : 'Enter name'}
          />
          <button
            onClick={handleSaveName}
            disabled={savingName}
            className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all shrink-0"
          >
            {savingName ? '...' : (t ? '保存' : 'Save')}
          </button>
        </div>
        {nameSuccess && (
          <div className="text-green-400 text-xs mt-2">{t ? '已保存' : 'Saved'}</div>
        )}
      </section>

      {/* Email (read-only) */}
      <section className="mb-8">
        <label className="block text-white/50 text-xs uppercase tracking-wider mb-2">
          {t ? '邮箱' : 'Email'}
        </label>
        <div style={{ ...inputStyle, color: 'rgba(255,255,255,0.5)', cursor: 'not-allowed' }}>
          {user.email}
        </div>
      </section>

      {/* Change Password (hide for OAuth users, collapsible) */}
      {!isOAuth && (
        <section className="mb-8">
          <button
            onClick={() => setPasswordOpen(v => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-white/50 text-xs uppercase tracking-wider">
              {t ? '修改密码' : 'Change Password'}
            </span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-white/30 transition-transform"
              style={{ transform: passwordOpen ? 'rotate(180deg)' : 'none' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {passwordOpen && (
            <div className="mt-3">
              <div className="space-y-3">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  style={inputStyle}
                  placeholder={t ? '当前密码' : 'Current password'}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={inputStyle}
                  placeholder={t ? '新密码' : 'New password'}
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={inputStyle}
                  placeholder={t ? '确认新密码' : 'Confirm new password'}
                />
              </div>
              {passwordError && (
                <div className="text-red-400 text-xs mt-2">{passwordError}</div>
              )}
              {passwordSuccess && (
                <div className="text-green-400 text-xs mt-2">{t ? '密码已更新' : 'Password updated'}</div>
              )}
              <button
                onClick={handleChangePassword}
                disabled={savingPassword || !currentPassword || !newPassword}
                className="mt-3 px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 disabled:opacity-30 transition-all"
              >
                {savingPassword ? '...' : (t ? '更新密码' : 'Update Password')}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Sign Out */}
      <section className="pt-4 border-t border-white/5">
        <button
          onClick={signOut}
          className="text-white/40 text-sm hover:text-white/60 transition-all"
        >
          {t ? '退出登录' : 'Sign Out'}
        </button>
      </section>
    </div>
  )
}
