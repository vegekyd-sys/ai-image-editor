import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'makaron-cli for AI Agents',
  description:
    'makaron.app is for humans. makaron-cli is for AI agents: talk to Makaron from the terminal to create persistent image, video, music, and animated design projects.',
  path: '/agent',
  image: '/landing/agent.jpg',
  keywords: [
    'makaron-cli',
    'AI agent creative CLI',
    'AI agent image editing',
    'AI agent video generation',
    'AI agent music generation',
    'Claude Code image generation',
    'Codex image generation',
    'MCP creative tools',
  ],
})

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children
}
