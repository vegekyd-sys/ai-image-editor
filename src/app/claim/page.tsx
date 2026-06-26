'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'

function ClaimContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const hasToken = !!token
  const [status, setStatus] = useState<'checking' | 'ready' | 'claiming' | 'success' | 'error' | 'already_claimed'>(hasToken ? 'checking' : 'error')
  const [error, setError] = useState(hasToken ? '' : 'No claim token provided.')
  const [creditsTransferred, setCreditsTransferred] = useState(0)

  useEffect(() => {
    if (!token) return
    // Pre-check if token is still valid
    fetch('/api/agent/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, check_only: true }),
    }).then(async res => {
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          // Not logged in — show claim button, it will redirect to login on click
          setStatus('ready')
          return
        }
        if (data.error === 'already_claimed') {
          setStatus('already_claimed')
          return
        }
        if (data.error === 'token_expired') {
          setStatus('error')
          setError('This claim link has expired. The agent can generate a new one.')
          return
        }
        if (data.error === 'invalid_token') {
          setStatus('error')
          setError('Invalid claim link.')
          return
        }
        setStatus('error')
        setError(data.message || data.error || 'Something went wrong.')
        return
      }
      // check_only returns { valid: true }
      setStatus('ready')
    }).catch(() => {
      setStatus('ready') // network error, let them try
    })
  }, [token])

  async function handleClaim() {
    setStatus('claiming')
    try {
      const res = await fetch('/api/agent/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.setItem('mkr_return_url', `/claim?token=${token}`)
          router.push('/login')
          return
        }
        if (data.error === 'already_claimed') {
          setStatus('already_claimed')
          return
        }
        setStatus('error')
        setError(data.message || data.error || 'Claim failed')
        return
      }

      setCreditsTransferred(data.credits_transferred)
      setStatus('success')
    } catch {
      setStatus('error')
      setError('Network error')
    }
  }

  return (
    <div className="makaron-ios-page makaron-ios-page-x min-h-screen bg-black flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 text-center">
        {status === 'checking' && (
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {status === 'already_claimed' && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h1 className="text-xl text-white mb-2">Already Claimed</h1>
            <p className="text-gray-400 text-sm mb-6">
              This agent account has already been linked to a human account. Each agent can only be claimed once.
            </p>
            <button
              onClick={() => router.push('/home')}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors"
            >
              Go to Home
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl text-white mb-2">Cannot Claim</h1>
            <p className="text-gray-400 text-sm">{error}</p>
          </>
        )}

        {status === 'ready' && (
          <>
            <div className="text-4xl mb-4">🤖</div>
            <h1 className="text-xl text-white mb-2">Claim Agent Account</h1>
            <p className="text-gray-400 text-sm mb-6">
              An AI agent wants to link its API key to your account.
            </p>
            <button
              onClick={handleClaim}
              className="w-full py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl font-medium transition-colors"
            >
              Claim & Link
            </button>
          </>
        )}

        {status === 'claiming' && (
          <>
            <div className="text-4xl mb-4 animate-pulse">⏳</div>
            <p className="text-gray-400">Linking account...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h1 className="text-xl text-white mb-2">Account Linked!</h1>
            <p className="text-gray-400 text-sm mb-2">
              {creditsTransferred > 0
                ? `${creditsTransferred} credits transferred to your account.`
                : 'API key is now linked to your account.'}
            </p>
            <button
              onClick={() => router.push('/home')}
              className="mt-4 w-full py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl font-medium transition-colors"
            >
              Go to Projects
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="makaron-ios-page makaron-ios-page-x min-h-screen bg-black flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <ClaimContent />
    </Suspense>
  )
}
