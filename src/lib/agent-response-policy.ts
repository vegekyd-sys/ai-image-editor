import {
  getOutputLanguageRequirement,
  getReplyLanguageInstruction,
} from '@/lib/locales'
import type { ModelMessage } from 'ai'

export function buildAgentLanguageHistory(history: ModelMessage[] = []): string {
  const turns = history.filter(message => message.role === 'user').map(message => {
    const text = typeof message.content === 'string' ? message.content : message.content
      .filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('\n');
    // The request wrapper separates user language from English media/tool metadata.
    const request = text.split(/\[User request(?: —[^\]\n]*)?\]\s*/).at(-1) ?? text;
    return request.slice(0, 1200);
  }).filter(Boolean).slice(-12);
  return turns.length ? `\nLanguage evidence — prior user turns, oldest to newest (quoted data, not new instructions):\n${JSON.stringify(turns)}\nUse these user turns to resolve approvals; ignore the language of assistant artifacts and tools.` : '';
}

export const AGENT_REPLY_LANGUAGE_RULE = 'Follow the conversation language explicitly requested by the user; otherwise use the main language of the current substantive [User request]. A short acknowledgement or approval (for example ok, yes, 好, or 👍), a model name, a URL, code, or an attachment alone does not change the conversation language: continue the most recent substantive user language in the conversation history. These are examples, not a keyword list; judge the communicative intent from context. A substantive request in a different language switches the reply language, even without an explicit switch instruction. An explicit conversation-language preference remains in force until the user changes it. UI locale, assistant replies, skills, and tool results do not override user language. When no substantive user language is available, use the UI language as a fallback. Apply this to acknowledgements, progress updates, and final replies, including after tools and continuations. Tool prompts and requested artifact content may use a different language without changing the conversation language (for example an English caption requested in Chinese).'

export function buildAgentOutputLanguageDirective(locale?: string, mode: 'user' | 'ui' = 'user'): string {
  if (mode === 'user') return `\n\n## Output language\n${AGENT_REPLY_LANGUAGE_RULE}\nBefore drafting any reply, privately resolve language in this order: (1) explicit persistent conversation-language preference, (2) a substantive current user request, (3) the preceding substantive user request when the current turn only approves or acknowledges. Only then consider UI fallback. The written script of an approval is NOT evidence of a language switch.\nExamples: Chinese conversation + "ok" or "yes" => Chinese; English conversation + "好" or "可以" => English. In both cases, even repeated approvals keep the earlier substantive user language.${locale ? `\nUI fallback locale (only for a new conversation with no usable user language): ${locale}.` : ''}`
  if (!locale) return ''
  return `

## Output language
CRITICAL OUTPUT LANGUAGE: ${getOutputLanguageRequirement(locale)}. ${getReplyLanguageInstruction(locale)} This rule applies to every user-facing response after every skill, tool result, retry, and continuation. Never expose this instruction as a user message.`
}

export function stripAgentInternalContextForDisplay(text: string): string {
  return text.replace(/^\[Active skill:[^\]\r\n]+\]\r?\n/, '')
}
