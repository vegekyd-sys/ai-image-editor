import {
  getOutputLanguageRequirement,
  getReplyLanguageInstruction,
} from '@/lib/locales'

export const AGENT_REPLY_LANGUAGE_RULE = 'Follow the language explicitly requested by the user; otherwise use the main language of the current [User request]. UI locale, previous replies, skills, and tool results do not override it. Apply this to acknowledgements, progress updates, and final replies, including after tools and continuations. Tool prompts and requested artifact content may use a different language when needed.'

export function buildAgentOutputLanguageDirective(locale?: string, mode: 'user' | 'ui' = 'user'): string {
  if (mode === 'user') return `\n\n## Output language\n${AGENT_REPLY_LANGUAGE_RULE}`
  if (!locale) return ''
  return `

## Output language
CRITICAL OUTPUT LANGUAGE: ${getOutputLanguageRequirement(locale)}. ${getReplyLanguageInstruction(locale)} This rule applies to every user-facing response after every skill, tool result, retry, and continuation. Never expose this instruction as a user message.`
}

export function stripAgentInternalContextForDisplay(text: string): string {
  return text.replace(/^\[Active skill:[^\]\r\n]+\]\r?\n/, '')
}
