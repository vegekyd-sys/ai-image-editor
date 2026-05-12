'use client'

import { useRouter } from 'next/navigation'
import AgentContent from '@/components/AgentContent'
import ModeToggle from '@/components/ModeToggle'

export default function AgentPage() {
  const router = useRouter()
  return (
    <>
      <AgentContent />
      <ModeToggle mode="agent" onToggle={(m) => { if (m === 'human') router.push('/home') }} />
    </>
  )
}
