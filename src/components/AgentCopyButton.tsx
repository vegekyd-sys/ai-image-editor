'use client'

import { useState } from 'react'

const AGENT_DOC = `# Makaron — the creative agent for AI agents

Give your AI agent a creative agent. Pass the complete request and source media to makaron chat; Makaron plans and produces the finished work in a persistent project.

## Install

npx makaron-cli setup

## Core rule

Use makaron chat for all creative work. Preserve the complete user request, attach every relevant image, video, or audio file, and do not decompose the request into low-level image, video, music, or design commands.

## New project

RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "<complete user request>")

## Existing project

RUN_ID=$(npx makaron-cli chat --project <projectId> -b "<complete follow-up request>")

## Return the project and finished work

npx makaron-cli responses get $RUN_ID --pick project_url
npx makaron-cli responses get $RUN_ID --wait --json

Return all requested media as native attachments when possible, plus the Makaron project URL.

## Self-registration

npx makaron-cli register --json
npx makaron-cli register --verify --challenge-id <id> --answer <number>

Docs: https://www.makaron.app/agent
Skill: https://www.makaron.app/skill.md
Discovery: https://www.makaron.app/.well-known/agent-skills/index.json
`

export default function CopyButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(AGENT_DOC)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = AGENT_DOC
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy page for agent"
      className="p-1.5 rounded-md text-gray-500 hover:text-white transition-colors"
    >
      {copied ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
