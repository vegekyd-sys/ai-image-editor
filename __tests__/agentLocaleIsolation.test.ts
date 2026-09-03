import { describe, expect, it } from 'vitest'
import path from 'path'
import { buildAgentOutputLanguageDirective, stripAgentInternalContextForDisplay } from '@/lib/agent-response-policy'
import { getChatSystemPrompt } from '@/lib/chat-response-policy'
import { getTipsPromptTemplate } from '@/lib/tips-response-policy'
import { readAgentAwareSource } from './helpers/agentRuntimeSource'

const root = path.resolve(__dirname, '..')
const read = (rel: string) => readAgentAwareSource(root, rel)

describe('Agent locale isolation', () => {
  it.each(['en', 'zh', 'zh-Hant', 'ja', undefined])('follows user language regardless of UI locale %s', (locale) => {
    const policy = buildAgentOutputLanguageDirective(locale)
    expect(policy).toBe(buildAgentOutputLanguageDirective('en'))
    expect(policy).toContain('language explicitly requested by the user')
    expect(policy).toContain('main language of the current [User request]')
    expect(policy).toContain('acknowledgements, progress updates, and final replies')
    expect(policy).toContain('Tool prompts and requested artifact content may use a different language')
    expect(policy).not.toContain('ENGLISH ONLY')
    expect(policy).not.toContain('CHINESE ONLY')
  })

  it('retains UI locale for automatic reactions without a user request', () => {
    const english = buildAgentOutputLanguageDirective('en', 'ui')
    const chinese = buildAgentOutputLanguageDirective('zh', 'ui')

    expect(english).toContain('ENGLISH ONLY')
    expect(english).toContain('Reply in English only.')
    expect(chinese).toContain('SIMPLIFIED CHINESE ONLY')
    expect(chinese).toContain('Reply in Simplified Chinese only.')
    expect(read('src/lib/agent.ts')).toContain("analysisOnly || tipReactionOnly ? 'ui' : 'user'")
  })

  it('does not let image analysis reintroduce a UI-language override', () => {
    const tools = read('src/lib/agent-tools.ts')
    expect(tools).toContain('Use the analysis above as visual evidence. ${AGENT_REPLY_LANGUAGE_RULE}')
    expect(tools).not.toContain("getReplyLanguageInstruction(locale).replace")
  })

  it('keeps internal skill context out of the visible user message', () => {
    expect(stripAgentInternalContextForDisplay('[Active skill: video-maker]\nMake a short launch video'))
      .toBe('Make a short launch video')
    expect(stripAgentInternalContextForDisplay('Mention [Active skill: demo] literally'))
      .toBe('Mention [Active skill: demo] literally')
  })

  it('does not append locale instructions to AI-initiated or tips user messages', () => {
    const agentRoute = read('src/app/api/agent/route.ts')
    const runRoute = read('src/app/api/agent/run/route.ts')
    const agent = read('src/lib/agent.ts')
    const tips = read('src/lib/gemini.ts')

    expect(agentRoute).not.toContain('withLocale')
    expect(runRoute).not.toContain('withLocale')
    expect(agent).not.toContain('function withLocale')
    expect(tips).not.toContain('localizedUserText')
    expect(tips).toContain('{ text: `${userText}${promptSuffix}` }')
    expect(tips).toContain("{ type: 'text', text: `${userText}${getJsonFormatSuffix(locale)}` }")
  })

  it('removes Chinese prompt inertia from English chat and tips while preserving Chinese chat', () => {
    const englishTips = getTipsPromptTemplate('creative', 'en', '中文模板')
    const chineseTips = getTipsPromptTemplate('creative', 'zh', '中文模板')

    expect(englishTips).not.toMatch(/[\u3400-\u9fff]/)
    expect(englishTips).toContain('photo-specific ideas')
    expect(chineseTips).toBe('中文模板')
    expect(getTipsPromptTemplate('creative', 'zh-Hant', '中文模板')).toBe('中文模板')
    expect(read('src/lib/gemini.ts')).toContain("normalizeLocale(locale) === 'en'")
    expect(read('src/lib/gemini.ts')).toContain('follow every rule below')
    expect(getChatSystemPrompt('en')).toContain('Reply in English only.')
    expect(getChatSystemPrompt('en')).not.toMatch(/[\u3400-\u9fff]/)
    expect(getChatSystemPrompt('zh')).toContain('用中文简短点评')
    expect(getChatSystemPrompt('zh-Hant')).toContain('用中文简短点评')
  })

  it('keeps provider/runtime error details server-side and localizes visible errors', () => {
    const agent = read('src/lib/agent.ts')
    const route = read('src/app/api/agent/route.ts')
    const runner = read('src/lib/agent-execution-runner.ts')

    expect(agent).toContain("responseLocale === 'zh' ? errorMessage : translate(responseLocale, 'agent.error.fatal')")
    expect(route).toContain("locale === 'zh' ? msg : translate(locale, 'agent.error.fatal')")
    expect(runner).toContain("translate(locale, 'agent.error.connectionEnded')")
  })
})
