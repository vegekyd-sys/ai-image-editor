import {
  getOutputLanguageRequirement,
  getReplyLanguageInstruction,
} from '@/lib/locales'

export const AGENT_REPLY_LANGUAGE_RULE = 'Reply in the language of the most recent substantive user message, respecting any explicit reply-language preference. Brief acknowledgements do not establish a new language; neither do tool output or requested artifacts.'

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
