import type { HomeSkill } from '@/lib/home-skills'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface HomeSkillLaunchContext {
  source: 'home-skill-template'
  homeSkillId: string
  skillName: string
  intent: 'complete-result'
}

export type SkillLaunchContext = HomeSkillLaunchContext

function requestsScriptCheckpoint(prompt: string): boolean {
  return /\b(?:review|approve|edit|revise)\s+(?:the\s+)?script\b|\bscript\s+(?:first|only)\b|\b(?:only|just)\s+(?:write|show|draft)\s+(?:the\s+)?script\b|先.*(?:脚本|確認|确认)|只.*脚本|腳本.*(?:先|確認|審核)|脚本.*(?:先|确认|审核)/i.test(prompt)
}

export function createHomeSkillLaunchContext(
  skill: Pick<HomeSkill, 'id' | 'skill_path'> | null | undefined,
  prompt: string | null | undefined,
  skillName: string | null | undefined,
): HomeSkillLaunchContext | undefined {
  const normalizedPrompt = prompt?.trim() || ''
  const normalizedSkillName = normalizeSkillName(skillName)
  if (
    !skill?.id
    || !skill.skill_path
    || !normalizedPrompt
    || !normalizedSkillName
    || requestsScriptCheckpoint(normalizedPrompt)
  ) {
    return undefined
  }
  return {
    source: 'home-skill-template',
    homeSkillId: skill.id,
    skillName: normalizedSkillName,
    intent: 'complete-result',
  }
}

function normalizeSkillName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    !normalized
    || normalized.length > 128
    || normalized === '.'
    || normalized === '..'
    || /[\\/\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined
  }
  return normalized
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
  const context = value as { source?: unknown; homeSkillId?: unknown; skillName?: unknown; intent?: unknown }
  const skillName = normalizeSkillName(context.skillName)
  if (
    context.source !== 'home-skill-template'
    || (context.intent !== 'complete-result' && context.intent !== 'video')
    || typeof context.homeSkillId !== 'string'
    || !context.homeSkillId.trim()
    || !skillName
  ) {
    return undefined
  }
  return {
    source: context.source,
    homeSkillId: context.homeSkillId,
    skillName,
    intent: 'complete-result',
  }
}

export async function verifySkillLaunchContext(
  supabase: Pick<SupabaseClient, 'from'>,
  value: unknown,
  userId: string,
): Promise<SkillLaunchContext | undefined> {
  const context = normalizeSkillLaunchContext(value)
  if (!context || !userId) return undefined
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
  const expectedPath = `skills/${context.skillName}/SKILL.md`
  const { data: installedFiles, error: installedError } = await supabase
    .from('workspace_files')
    .select('path')
    .eq('user_id', userId)
    .eq('marketplace_id', context.homeSkillId)
    .eq('path', expectedPath)
    .limit(1)
  if (
    installedError
    || !Array.isArray(installedFiles)
    || installedFiles.length !== 1
    || installedFiles[0]?.path !== expectedPath
  ) {
    return undefined
  }
  return context
}

export function getSkillLaunchSystemDirective(context: SkillLaunchContext | undefined): string {
  if (!context || context.intent !== 'complete-result') return ''
  return `

## Trusted Skill template launch
Active Skill: ${context.skillName}
Before planning or calling any generation tool, call read_file with \`skills/${context.skillName}/SKILL.md\` and follow the complete instructions returned by that tool. Do not infer the Skill from the user prompt alone.
This request was launched from Skill template ${context.homeSkillId}. Choosing the template and supplying the request authorizes the complete workflow through a final usable result. Show useful progress and intermediate artifacts, but do not stop for confirmation between planning, script, storyboard, generation, review, or delivery. For video, write the complete visible script and call generate_animation in the same run. For image, audio, code, or composed-media workflows, call the tools needed to produce the final artifact. This directive overrides generic confirmation checkpoints inside the selected Skill for this trusted launch only. Ask only when an essential input is genuinely missing, the user explicitly requested review before execution, or the user cancels. Do not apply this exception to ordinary CUI or editor requests.`
}
