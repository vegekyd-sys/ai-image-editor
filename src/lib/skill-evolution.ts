import { createHash } from 'node:crypto'

export const EVOLVING_SKILLS = {
  animate: {
    sourcePath: 'prompts/animate.md',
    label: 'Animate',
  },
  'tiktok-video': {
    sourcePath: 'skills/tiktok-video/SKILL.md',
    label: 'TikTok Video',
  },
  'talking-head': {
    sourcePath: 'skills/talking-head/SKILL.md',
    label: 'Talking Head',
  },
} as const

export type EvolvingSkillKey = keyof typeof EVOLVING_SKILLS
export type SkillActivationSource = 'read_file' | 'skill_launch' | 'system_prompt' | 'backfill'

export interface SkillFingerprint {
  skillKey: EvolvingSkillKey
  sourcePath: string
  contentSha256: string
  contentLength: number
}

export type SkillQualityDimension =
  | 'visualQuality'
  | 'promptFidelity'
  | 'motionCoherence'
  | 'narrativeClarity'
  | 'platformFit'
  | 'hookStrength'
  | 'captionQuality'
  | 'audioVisualCohesion'
  | 'editorialJudgment'

export interface SkillQualitySignals {
  artifactCreated?: boolean
  fullyDecodable?: boolean
  durationComplete?: boolean
  deliveryResolutionCorrect?: boolean
  safeZoneCompliant?: boolean
  audioWithinSpec?: boolean
  audioContinuous?: boolean
  captionsSynchronized?: boolean
  noUnintendedRepeatedFrames?: boolean
  hasSpeech?: boolean
  hasVisibleText?: boolean
  qualityDimensions?: Partial<Record<SkillQualityDimension, number>>
}

export interface SkillGateResult {
  key: string
  status: 'pass' | 'fail' | 'unknown' | 'not_applicable'
}

export interface SkillRunEvaluation {
  skillKey: EvolvingSkillKey
  outcome: 'pass' | 'fail' | 'inconclusive'
  hardGates: SkillGateResult[]
  overallScore: number | null
  scoreCoverage: number
}

interface SkillEvolutionRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

function normalizeSkillPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized === 'src/lib/prompts/animate.md') return 'prompts/animate.md'
  if (normalized.startsWith('src/')) return normalized.slice('src/'.length)
  return normalized
}

export function resolveEvolvingSkill(sourcePath: string): EvolvingSkillKey | null {
  const normalized = normalizeSkillPath(sourcePath)
  for (const [skillKey, config] of Object.entries(EVOLVING_SKILLS)) {
    if (config.sourcePath === normalized) return skillKey as EvolvingSkillKey
  }
  return null
}

export function fingerprintEvolvingSkill(sourcePath: string, content: string): SkillFingerprint | null {
  const skillKey = resolveEvolvingSkill(sourcePath)
  if (!skillKey) return null
  return {
    skillKey,
    sourcePath: EVOLVING_SKILLS[skillKey].sourcePath,
    contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    contentLength: Buffer.byteLength(content, 'utf8'),
  }
}

export async function recordEvolvingSkillUsage(input: {
  /** Test/backfill override. Production callers use the server-only admin client. */
  supabase?: SkillEvolutionRpcClient | null
  runId?: string | null
  projectId?: string | null
  userId?: string | null
  sourcePath: string
  content: string
  activationSource?: SkillActivationSource
  observedAt?: string
}): Promise<SkillFingerprint | null> {
  const fingerprint = fingerprintEvolvingSkill(input.sourcePath, input.content)
  if (!fingerprint || !input.runId || !input.projectId || !input.userId) {
    return fingerprint
  }

  try {
    const client = input.supabase || (await import('@/lib/supabase/service')).getSupabaseAdmin()
    if (typeof client.rpc !== 'function') return fingerprint
    const { error } = await client.rpc('record_skill_run_usage', {
      p_run_id: input.runId,
      p_project_id: input.projectId,
      p_user_id: input.userId,
      p_skill_key: fingerprint.skillKey,
      p_source_path: fingerprint.sourcePath,
      p_content_sha256: fingerprint.contentSha256,
      p_content_length: fingerprint.contentLength,
      p_activation_source: input.activationSource ?? 'read_file',
      p_git_sha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
      p_observed_at: input.observedAt ?? new Date().toISOString(),
      p_metadata: {
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
      },
    })
    if (error) throw new Error(error.message || 'unknown RPC error')
  } catch (error) {
    // Telemetry must never block the user's creative run. A missing migration is
    // expected while the worktree is being evaluated before deployment.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[skill-evolution] usage record failed for ${fingerprint.skillKey}: ${message}`)
  }
  return fingerprint
}

const DIMENSION_WEIGHTS: Record<EvolvingSkillKey, Partial<Record<SkillQualityDimension, number>>> = {
  animate: {
    visualQuality: 0.3,
    promptFidelity: 0.25,
    motionCoherence: 0.25,
    narrativeClarity: 0.2,
  },
  'tiktok-video': {
    platformFit: 0.25,
    hookStrength: 0.2,
    captionQuality: 0.2,
    audioVisualCohesion: 0.2,
    visualQuality: 0.15,
  },
  'talking-head': {
    editorialJudgment: 0.25,
    narrativeClarity: 0.2,
    captionQuality: 0.2,
    audioVisualCohesion: 0.2,
    visualQuality: 0.15,
  },
}

function gate(key: string, value: boolean | undefined, applicable = true): SkillGateResult {
  if (!applicable) return { key, status: 'not_applicable' }
  if (value === undefined) return { key, status: 'unknown' }
  return { key, status: value ? 'pass' : 'fail' }
}

function buildHardGates(skillKey: EvolvingSkillKey, signals: SkillQualitySignals): SkillGateResult[] {
  const common = [
    gate('artifact_created', signals.artifactCreated),
    gate('fully_decodable', signals.fullyDecodable),
    gate('duration_complete', signals.durationComplete),
  ]
  if (skillKey === 'animate') return common
  if (skillKey === 'tiktok-video') {
    return [
      ...common,
      gate('delivery_resolution_correct', signals.deliveryResolutionCorrect),
      gate('safe_zone_compliant', signals.safeZoneCompliant, signals.hasVisibleText !== false),
      gate('audio_within_spec', signals.audioWithinSpec),
      gate('captions_synchronized', signals.captionsSynchronized, signals.hasSpeech !== false),
    ]
  }
  return [
    ...common,
    gate('audio_continuous', signals.audioContinuous),
    gate('captions_synchronized', signals.captionsSynchronized, signals.hasSpeech !== false),
    gate('no_unintended_repeated_frames', signals.noUnintendedRepeatedFrames),
  ]
}

function calculateScore(
  skillKey: EvolvingSkillKey,
  dimensions: SkillQualitySignals['qualityDimensions'],
): { score: number | null; coverage: number } {
  const weights = DIMENSION_WEIGHTS[skillKey]
  let weightedScore = 0
  let observedWeight = 0
  let totalWeight = 0
  for (const [dimension, weight] of Object.entries(weights)) {
    totalWeight += weight
    const rawValue = dimensions?.[dimension as SkillQualityDimension]
    if (rawValue === undefined || !Number.isFinite(rawValue)) continue
    observedWeight += weight
    weightedScore += Math.max(0, Math.min(100, rawValue)) * weight
  }
  const coverage = totalWeight > 0 ? observedWeight / totalWeight : 0
  return {
    score: coverage >= 0.6 && observedWeight > 0
      ? Math.round((weightedScore / observedWeight) * 10) / 10
      : null,
    coverage: Math.round(coverage * 1000) / 1000,
  }
}

export function evaluateSkillRun(
  skillKey: EvolvingSkillKey,
  signals: SkillQualitySignals,
): SkillRunEvaluation {
  const hardGates = buildHardGates(skillKey, signals)
  const applicable = hardGates.filter(item => item.status !== 'not_applicable')
  const outcome = applicable.some(item => item.status === 'fail')
    ? 'fail'
    : applicable.some(item => item.status === 'unknown')
      ? 'inconclusive'
      : 'pass'
  const { score, coverage } = calculateScore(skillKey, signals.qualityDimensions)
  return {
    skillKey,
    outcome,
    hardGates,
    overallScore: score,
    scoreCoverage: coverage,
  }
}
