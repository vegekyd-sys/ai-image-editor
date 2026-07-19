import {
  getOutputLanguageRequirement,
  getReplyLanguageInstruction,
} from '@/lib/locales'

export function buildAgentOutputLanguageDirective(locale?: string): string {
  if (!locale) return ''
  return `

## Output language
CRITICAL OUTPUT LANGUAGE: ${getOutputLanguageRequirement(locale)}. ${getReplyLanguageInstruction(locale)} This rule applies to every user-facing response after every skill, tool result, retry, and continuation. Never expose this instruction as a user message.`
}

export function stripAgentInternalContextForDisplay(text: string): string {
  return text.replace(/^\[Active skill:[^\]\r\n]+\]\r?\n/, '')
}
