'use client'

interface ModeToggleProps {
  hidden?: boolean
  mode?: 'human' | 'agent'
  onToggle?: (mode: 'human' | 'agent') => void
}

export default function ModeToggle({ hidden, mode, onToggle }: ModeToggleProps) {
  const isAgent = mode === 'agent'

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 16,
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'none',
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    transition: 'all 0.15s',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
  })

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 101,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 0.2s',
        touchAction: 'manipulation',
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
        <button onClick={() => onToggle?.('human')} style={btnStyle(!isAgent)}>
          Human
        </button>
        <button onClick={() => onToggle?.('agent')} style={btnStyle(isAgent)}>
          Agent
        </button>
      </div>
    </div>
  )
}
