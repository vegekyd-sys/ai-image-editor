import type { HomeSkill } from '@/lib/home-skills'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface VideoSkillLaunchContext {
  source: 'home-skill-template'
  homeSkillId: string
  intent: 'video'
}

export type SkillLaunchContext = VideoSkillLaunchContext

function requestsScriptCheckpoint(prompt: string): boolean {
  return /\b(?:review|approve|edit|revise)\s+(?:the\s+)?script\b|\bscript\s+(?:first|only)\b|\b(?:only|just)\s+(?:write|show|draft)\s+(?:the\s+)?script\b|先.*(?:脚本|確認|确认)|只.*脚本|腳本.*(?:先|確認|審核)|脚本.*(?:先|确认|审核)/i.test(prompt)
}

function requestsLongVideoWorkflow(prompt: string): boolean {
  return /\b(?:long[- ]form|multi[- ]segment|multi[- ]scene)\b|\b(?:1[6-9]|[2-9]\d)\s*(?:s|sec|secs|second|seconds)\b|(?:1[6-9]|[2-9]\d)\s*秒|长视频|長影片|多段|分段视频|分段影片/i.test(prompt)
}

export function createVideoSkillLaunchContext(
  skill: Pick<HomeSkill, 'id' | 'skill_path' | 'categories'> | null | undefined,
  prompt: string | null | undefined,
): VideoSkillLaunchContext | undefined {
  const normalizedPrompt = prompt?.trim() || ''
  if (
    !skill?.id
    || !skill.skill_path
    || !normalizedPrompt
    || !skill.categories?.includes('video')
    || requestsScriptCheckpoint(normalizedPrompt)
    || requestsLongVideoWorkflow(normalizedPrompt)
  ) {
    return undefined
  }
  return {
    source: 'home-skill-template',
    homeSkillId: skill.id,
    intent: 'video',
  }
}

export function shouldContinueSkillVideoSubmission(input: {
  context?: SkillLaunchContext
  visibleText: string
  submissionStarted: boolean
}): boolean {
  if (!input.context || input.submissionStarted) return false
  return /(?:^|\n)\s*(?:#{1,3}\s*)?(?:Shot|Scene)\s*1\b/i.test(input.visibleText)
}

export function normalizeSkillLaunchContext(value: unknown): SkillLaunchContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const context = value as Partial<SkillLaunchContext>
  if (
    context.source !== 'home-skill-template'
    || context.intent !== 'video'
    || typeof context.homeSkillId !== 'string'
    || !context.homeSkillId.trim()
  ) {
    return undefined
  }
  return {
    source: context.source,
    homeSkillId: context.homeSkillId,
    intent: context.intent,
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
    .select('id, skill_path, categories, is_active')
    .eq('id', context.homeSkillId)
    .single()
  if (
    error
    || !data
    || data.is_active === false
    || !data.skill_path
    || !Array.isArray(data.categories)
    || !data.categories.includes('video')
  ) {
    return undefined
  }
  return context
}

export function getSkillLaunchSystemDirective(context: SkillLaunchContext | undefined): string {
  if (!context || context.intent !== 'video') return ''
  return `

## Trusted Skill template launch
This request was launched from the Video Skill template ${context.homeSkillId}. The user chose this template and supplied the request before project creation, so a clear short-video intent is already authorized for direct submission. Write the complete visible script, then call generate_animation in the same turn without asking for a second confirmation. Keep normal validation: if required media or essential inputs are missing, ask only for those inputs; if the request requires a multi-segment or long-video plan, follow that workflow and retain its approval checkpoint; if the user explicitly asks to review the script first, stop after the script. This exception applies only to this launch context and must not change ordinary CUI or editor video requests.`
}
