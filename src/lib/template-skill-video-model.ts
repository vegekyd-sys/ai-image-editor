/**
 * Template Skills (installed from the home template marketplace) keep FAL H3
 * Max as their video default. User decision 2026-11-09: the app default moved
 * to Kling 4.0 Flash, but a template that never named a video model must keep
 * rendering on the model it was authored and tuned against.
 */
import { parseSkillMd } from './skill-registry'
import { getDefaultVideoModelId, getVideoModelRetirementError, listVideoModelCapabilities, normalizeVideoModelId } from './video-model-capabilities'

export const TEMPLATE_SKILL_DEFAULT_VIDEO_MODEL = 'fal-h3-max'

const SKILL_PATH = /^skills\/([^/]+)\/SKILL\.md$/

export function skillNameFromSkillPath(path: string): string | undefined {
  return SKILL_PATH.exec(path.trim())?.[1]
}

export function activeSkillNameFromPrompt(prompt: string | undefined): string | undefined {
  return /^\[Active skill:\s*([^\]\r\n]+?)\s*\]/.exec(prompt || '')?.[1]
}

function knownVideoModel(value: string | undefined): string | undefined {
  const raw = String(value || '').trim().replace(/^["'`]|["'`,]$/g, '')
  if (!raw) return undefined
  const id = normalizeVideoModelId(raw)
  if (getVideoModelRetirementError(id)) return undefined
  return listVideoModelCapabilities().some(capability => capability.id === id) ? id : undefined
}

/**
 * The video model a Skill explicitly names, in priority order: metadata
 * `modelPreference` (first video entry), a front-matter `model` / `videoModel`
 * key, then an explicit `model: "<id>"` / `--video-model <id>` in the body.
 * Prose that merely mentions a provider does not count.
 */
export function parseSkillExplicitVideoModel(skillMd: string): string | undefined {
  const parsed = parseSkillMd(skillMd)
  for (const entry of parsed?.makaron.modelPreference || []) {
    const id = knownVideoModel(entry)
    if (id) return id
  }
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)
  const frontmatter = frontmatterMatch?.[1] || ''
  for (const match of frontmatter.matchAll(/^\s*(?:videoModel|video_model|model)\s*:\s*([^\s#]+)/gm)) {
    const id = knownVideoModel(match[1])
    if (id) return id
  }
  const body = skillMd.slice(frontmatterMatch?.[0].length ?? 0)
  for (const match of body.matchAll(/(?:\bmodel\s*[:=]\s*|--video-model\s+)["'`]?([a-z0-9][a-z0-9.\-]*)/gi)) {
    const id = knownVideoModel(match[1])
    if (id) return id
  }
  return undefined
}

export interface TemplateSkillContext {
  supabase?: any
  userId?: string
  /** Skill names in priority order: template launch, `[Active skill: X]`, skills read this run. */
  candidateSkillNames: string[]
}

/** Resolve the video model a template Skill should use, or undefined when no template is active. */
export async function resolveTemplateSkillVideoModel(context: TemplateSkillContext): Promise<{ skillName: string; model: string; explicit: boolean } | undefined> {
  if (!context.supabase || !context.userId) return undefined
  const names = [...new Set(context.candidateSkillNames.filter(Boolean))]
  for (const skillName of names) {
    const path = `skills/${skillName}/SKILL.md`
    const { data, error } = await context.supabase
      .from('workspace_files')
      .select('marketplace_id')
      .eq('user_id', context.userId)
      .eq('path', path)
      .limit(1)
    if (error || !Array.isArray(data) || !data[0]?.marketplace_id) continue
    const { readFile } = await import('./workspace')
    const file = await readFile(path, context.supabase, context.userId)
    const explicit = file?.content ? parseSkillExplicitVideoModel(file.content) : undefined
    return { skillName, model: explicit ?? TEMPLATE_SKILL_DEFAULT_VIDEO_MODEL, explicit: Boolean(explicit) }
  }
  return undefined
}

/**
 * Apply a template Skill's model when the Agent left the choice to the default:
 * the tool omitted `model`, or passed the app-wide default. Any other model the
 * Agent chose on purpose (21-30s Seedance, NSFW Wan, replication) is kept.
 */
export function applyTemplateVideoModel(toolModel: string | undefined, templateModel: string | undefined): string | undefined {
  if (!templateModel) return toolModel
  if (!toolModel || normalizeVideoModelId(toolModel) === getDefaultVideoModelId()) return templateModel
  return toolModel
}
