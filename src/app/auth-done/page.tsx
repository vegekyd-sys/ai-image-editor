'use client'

import { useEffect } from 'react'

export default function AuthDonePage() {
  useEffect(() => {
    let returnUrl = sessionStorage.getItem('mkr_return_url') || localStorage.getItem('mkr_return_url') || ''
    sessionStorage.removeItem('mkr_return_url')
    localStorage.removeItem('mkr_return_url')

    const params = new URLSearchParams(window.location.search)
    const welcome = params.get('welcome')

    // Convert /home/{skillId} to /home?skill={skillId} to avoid server redirect losing query params
    const skillMatch = returnUrl.match(/^\/home\/([^/?]+)/)
    if (skillMatch) {
      returnUrl = `/home?skill=${skillMatch[1]}`
    }

    let target = returnUrl || '/projects'
    if (welcome) {
      const sep = target.includes('?') ? '&' : '?'
      target = target + sep + 'welcome=1'
    }

    window.location.href = target
  }, [])

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center">
      <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}
