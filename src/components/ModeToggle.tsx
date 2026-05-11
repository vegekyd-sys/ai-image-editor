'use client'

import { usePathname, useRouter } from 'next/navigation'

interface ModeToggleProps {
  hidden?: boolean
}

export default function ModeToggle({ hidden }: ModeToggleProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isAgent = pathname === '/agent'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'env(safe-area-inset-bottom, 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 0.2s',
      }}
    >
      <div
        style={{
          display: 'flex',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(24,24,28,0.9)',
          backdropFilter: 'blur(8px)',
          padding: 3,
        }}
      >
        <button
          onClick={() => !isAgent ? undefined : router.push('/home')}
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.65rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            transition: 'all 0.2s',
            background: !isAgent ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: !isAgent ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
          }}
        >
          Human
        </button>
        <button
          onClick={() => isAgent ? undefined : router.push('/agent')}
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.65rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            transition: 'all 0.2s',
            background: isAgent ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: isAgent ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
          }}
        >
          Agent
        </button>
      </div>
    </div>
  )
}
