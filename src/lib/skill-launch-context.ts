import type { HomeSkill } from '@/lib/home-skills'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface HomeSkillLaunchContext {
  source: 'home-skill-template'
  homeSkillId: string
  intent: 'complete-result'
}

export type SkillLaunchContext = HomeSkillLaunchContext

function requestsScriptCheckpoint(prompt: string): boolean {
  return /\b(?:review|approve|edit|revise)\s+(?:the\s+)?script\b|\bscript\s+(?:first|only)\b|\b(?:only|just)\s+(?:write|show|draft)\s+(?:the\s+)?script\b|先.*(?:脚本|確認|确认)|只.*脚本|腳本.*(?:先|確認|審核)|脚本.*(?:先|确认|审核)/i.test(prompt)
}

export function createHomeSkillLaunchContext(
  skill: Pick<HomeSkill, 'id' | 'skill_path'> | null | undefined,
  prompt: string | null | undefined,
): HomeSkillLaunchContext | undefined {
  const normalizedPrompt = prompt?.trim() || ''
  if (
    !skill?.id
    || !skill.skill_path
    || !normalizedPrompt
    || requestsScriptCheckpoint(normalizedPrompt)
  ) {
    return undefined
  }
  return {
    source: 'home-skill-template',
    homeSkillId: skill.id,
    intent: 'complete-result',
  }
}

export function shouldContinueSkillVideoSubmission(input: {
  context?: SkillLaunchContext
  visibleText: string
  submissionStarted: boolean
}): boolean {
  if (!input.context || input.submissionStarted) return false
  return /(?:^|\n)\s*(?:#{1,3}\s*)?(?:(?:Shot|Scene)\s*1\b|(?:镜头|鏡頭|场景|場景)\s*[：:]?\s*1\b|ショット\s*[：:]?\s*1\b)/i.test(input.visibleText)
}

export function normalizeSkillLaunchContext(value: unknown): SkillLaunchContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const context = value as { source?: unknown; homeSkillId?: unknown; intent?: unknown }
  if (
    context.source !== 'home-skill-template'
    || (context.intent !== 'complete-result' && context.intent !== 'video')
    || typeof context.homeSkillId !== 'string'
    || !context.homeSkillId.trim()
  ) {
    return undefined
  }
  return {
    source: context.source,
    homeSkillId: context.homeSkillId,
    intent: 'complete-result',
  }
}

export async function verifySkillLaunchContext(
  supabase: Pick<SupabaseClient, 'from'>,
  value: unknown,
): Promise<SkillLaunchContext | undefined> {
  const context = normalizeSkillLaunchContext(value)
  if (!context) return undefined
  const { data, error } = await supabase
    .from('home_skills')
    .select('id, skill_path, is_active')
    .eq('id', context.homeSkillId)
    .single()
  if (
    error
    || !data
    || data.is_active === false
    || !data.skill_path
  ) {
    return undefined
  }
  return context
}

export function getSkillLaunchSystemDirective(context: SkillLaunchContext | undefined): string {
  if (!context || context.intent !== 'complete-result') return ''
  return `

## Trusted Skill template launch
This request was launched from Skill template ${context.homeSkillId}. Choosing the template and supplying the request authorizes the complete workflow through a final usable result. Show useful progress and intermediate artifacts, but do not stop for confirmation between planning, script, storyboard, generation, review, or delivery. For video, write the complete visible script and call generate_animation in the same run. For image, audio, code, or composed-media workflows, call the tools needed to produce the final artifact. This directive overrides generic confirmation checkpoints inside the selected Skill for this trusted launch only. Ask only when an essential input is genuinely missing, the user explicitly requested review before execution, or the user cancels. Do not apply this exception to ordinary CUI or editor requests.`
}
