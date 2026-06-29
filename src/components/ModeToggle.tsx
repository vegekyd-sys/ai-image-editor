'use client'

import LiquidGlassNav, { type LiquidGlassNavValue } from '@/components/LiquidGlassNav'

interface ModeToggleProps {
  hidden?: boolean
  mode?: 'human' | 'agent'
  onToggle?: (mode: 'human' | 'agent') => void
}

export default function ModeToggle({ hidden, mode, onToggle }: ModeToggleProps) {
  return (
    <LiquidGlassNav
      active={mode ?? 'human'}
      hidden={hidden}
      requireAuth={false}
      ariaLabel="Human and agent mode"
      items={[
        { value: 'human', label: 'Human' },
        { value: 'agent', label: 'Agent' },
      ]}
      onChange={(value: LiquidGlassNavValue) => {
        if (value === 'human' || value === 'agent') onToggle?.(value)
      }}
    />
  )
}
