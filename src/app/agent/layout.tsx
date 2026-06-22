import type { Metadata } from 'next'
import { buildPublicMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPublicMetadata({
  title: 'Makaron Agent Skill for AI Agents',
  description:
    'Install the Makaron Agent Skill from the makaron-cli npm package, then create images, videos, music, and animated designs from the terminal.',
  path: '/agent',
  image: '/landing/agent.jpg',
  keywords: [
    'Makaron skill',
    'Agent skill',
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
