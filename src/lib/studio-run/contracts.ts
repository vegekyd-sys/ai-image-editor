import { z } from 'zod';
import { preparedVisualAssetSchema, sceneVisualPlanSchema } from '../visual-assets/contracts';

export const STUDIO_STAGE_IDS = [
  'brief',
  'proposal',
  'script',
  'storyboard',
  'assets',
  'composition',
  'review',
  'delivery',
] as const;

export const studioStageIdSchema = z.enum(STUDIO_STAGE_IDS);
export type StudioStageId = z.infer<typeof studioStageIdSchema>;

export const approvalPolicySchema = z.enum(['auto', 'guided', 'manual']);
export type StudioApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const runStatusSchema = z.enum([
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type StudioRunStatus = z.infer<typeof runStatusSchema>;

export const stageStatusSchema = z.enum([
  'pending',
  'in_progress',
  'awaiting_approval',
  'completed',
  'invalidated',
  'failed',
]);
export type StudioStageStatus = z.infer<typeof stageStatusSchema>;

export const deliveryPromiseSchema = z.object({
  durationSeconds: z.number().positive().max(600),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().max(120),
  renderRuntime: z.enum(['remotion', 'ffmpeg', 'provider-video']),
  compositionMode: z.enum(['editable', 'atelier', 'templated']),
  audioRequired: z.boolean(),
  subtitlesRequired: z.boolean(),
});
export type StudioDeliveryPromise = z.infer<typeof deliveryPromiseSchema>;

const timedSectionSchema = z.object({
  id: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  narration: z.string(),
  onScreenText: z.array(z.string()).default([]),
}).refine(section => section.endSeconds > section.startSeconds, {
  message: 'endSeconds must be greater than startSeconds',
});

const narrationTimingSourceSchema = z.enum(['transcribe_audio', 'explicit-audio-placement']);

const narrationTimingEvidenceSchema = z.object({
  scriptSectionId: z.string().min(1),
  sceneId: z.string().min(1),
  narrationStartSeconds: z.number().nonnegative(),
  narrationEndSeconds: z.number().positive(),
  timingSource: narrationTimingSourceSchema,
}).refine(value => value.narrationEndSeconds > value.narrationStartSeconds, {
  message: 'narrationEndSeconds must be after narrationStartSeconds',
});

const briefSchema = z.object({
  version: z.literal('1.0'),
  title: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  coreMessage: z.string().min(1),
  language: z.string().min(2),
  durationSeconds: z.number().positive().max(600),
  aspectRatio: z.string().regex(/^\d+:\d+$/),
});

const proposalSchema = z.object({
  version: z.literal('1.0'),
  concepts: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    hook: z.string().min(1),
    visualDirection: z.string().min(1),
    motionLanguage: z.string().min(1),
  })).min(2),
  selectedConceptId: z.string().min(1),
  rationale: z.string().min(1),
  deliveryPromise: deliveryPromiseSchema,
  estimatedCostUsd: z.number().nonnegative(),
}).superRefine((value, ctx) => {
  if (!value.concepts.some(concept => concept.id === value.selectedConceptId)) {
    ctx.addIssue({ code: 'custom', message: 'selectedConceptId must reference a concept' });
  }
});

const scriptSchema = z.object({
  version: z.literal('1.0'),
  title: z.string().min(1),
  totalDurationSeconds: z.number().positive().max(600),
  sections: z.array(timedSectionSchema).min(1),
}).superRefine((value, ctx) => {
  const last = value.sections[value.sections.length - 1];
  if (Math.abs((last?.endSeconds ?? 0) - value.totalDurationSeconds) > 0.25) {
    ctx.addIssue({ code: 'custom', message: 'script sections must cover the target duration' });
  }
});

const storyboardSchema = z.object({
  version: z.literal('1.0'),
  scenes: z.array(z.object({
    id: z.string().min(1),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    purpose: z.string().min(1),
    focalPoint: z.string().min(1),
    visualTreatment: z.string().min(1),
    transitionOut: z.string().min(1),
    assetIds: z.array(z.string()),
    visualPlan: sceneVisualPlanSchema.optional(),
  }).refine(scene => scene.endSeconds > scene.startSeconds, {
    message: 'scene endSeconds must be greater than startSeconds',
  })).min(1),
  artDirection: z.string().min(1),
  layoutContract: z.string().min(1),
  subtitleSafeArea: z.string().min(1),
  narrationTimingEvidence: z.array(narrationTimingEvidenceSchema).optional(),
});

const assetManifestSchema = z.object({
  version: z.literal('1.0'),
  assets: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['image', 'video', 'audio', 'music', 'font', 'code']),
    path: z.string().min(1),
    source: z.string().min(1),
    sceneIds: z.array(z.string()).min(1),
    status: z.enum(['ready', 'missing', 'failed']),
    costUsd: z.number().nonnegative(),
    role: z.enum(['hero', 'support', 'decoration']).optional(),
    prepared: preparedVisualAssetSchema.optional(),
  })).min(1),
  totalCostUsd: z.number().nonnegative(),
  missingAssetIds: z.array(z.string()),
}).refine(value => value.assets.every(asset => asset.status === 'ready') && value.missingAssetIds.length === 0, {
  message: 'all assets must be ready before composition',
});

const mp4OutputPathSchema = z.string().min(1).refine((value) => {
  const pathWithoutQuery = value.split(/[?#]/, 1)[0];
  return /\.mp4$/i.test(pathWithoutQuery);
}, { message: 'outputPath must reference a materialized MP4, not an editable composition' });

const subtitleSyncEvidenceSchema = z.object({
  scriptSectionId: z.string().min(1),
  sceneId: z.string().min(1),
  visualStartSeconds: z.number().nonnegative(),
  visualEndSeconds: z.number().positive(),
  narrationStartSeconds: z.number().nonnegative(),
  narrationEndSeconds: z.number().positive(),
  representativeFrameSeconds: z.number().nonnegative(),
  subtitleText: z.string().min(1).describe('Exact caption text authored for this representative frame.'),
  timingSource: narrationTimingSourceSchema,
}).superRefine((value, ctx) => {
  if (value.visualEndSeconds <= value.visualStartSeconds) {
    ctx.addIssue({ code: 'custom', path: ['visualEndSeconds'], message: 'visualEndSeconds must be after visualStartSeconds' });
  }
  if (value.narrationEndSeconds <= value.narrationStartSeconds) {
    ctx.addIssue({ code: 'custom', path: ['narrationEndSeconds'], message: 'narrationEndSeconds must be after narrationStartSeconds' });
  }
  if (
    value.representativeFrameSeconds < Math.max(value.visualStartSeconds, value.narrationStartSeconds)
    || value.representativeFrameSeconds > Math.min(value.visualEndSeconds, value.narrationEndSeconds)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['representativeFrameSeconds'],
      message: 'representativeFrameSeconds must fall inside both the visual and narration ranges',
    });
  }
});

const subtitleVisualReviewEvidenceSchema = z.object({
  scriptSectionId: z.string().min(1),
  sceneId: z.string().min(1),
  representativeFrameSeconds: z.number().nonnegative(),
  framePath: z.string().min(1),
  displayedText: z.string().min(1).describe('Exact caption visible in this final-MP4 frame. It must match Composition subtitleText; do not translate, summarize, or substitute the scene title.'),
  observedVisualContent: z.string().min(1),
  alignment: z.enum(['pass', 'fail']),
});

const compositionSchema = z.object({
  version: z.literal('1.0'),
  runtime: z.literal('remotion'),
  mode: z.enum(['editable', 'atelier', 'templated']),
  designPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationSeconds: z.number().positive(),
  sceneIds: z.array(z.string()).min(1),
  previewFramePaths: z.array(z.string()).min(3),
  draftGate: z.object({
    expectedDurationFrames: z.number().int().positive(),
    timelineDurationFrames: z.number().int().positive(),
    boundaryFramesChecked: z.number().int().nonnegative(),
    endingFrameChecked: z.boolean(),
    audioSources: z.enum(['resolved', 'not-required']),
    visualPlanChecked: z.boolean(),
    underfilledSceneIds: z.array(z.string()),
    subtitleSyncEvidence: z.array(subtitleSyncEvidenceSchema),
    unresolvedIssues: z.array(z.string()),
  }),
  editable: z.boolean(),
}).superRefine((value, ctx) => {
  const expectedFrames = Math.round(value.durationSeconds * value.fps);
  const requiredBoundaries = Math.max(0, value.sceneIds.length - 1);
  const checks: Array<[boolean, (string | number)[], string]> = [
    [value.draftGate.expectedDurationFrames === expectedFrames, ['draftGate', 'expectedDurationFrames'], `expectedDurationFrames must equal durationSeconds * fps (${expectedFrames})`],
    [value.draftGate.timelineDurationFrames === expectedFrames, ['draftGate', 'timelineDurationFrames'], `timelineDurationFrames must cover the full composition (${expectedFrames})`],
    [value.draftGate.boundaryFramesChecked >= requiredBoundaries, ['draftGate', 'boundaryFramesChecked'], `check every scene boundary before review (${requiredBoundaries} required)`],
    [value.draftGate.endingFrameChecked, ['draftGate', 'endingFrameChecked'], 'check the final visible frame before review'],
    [value.draftGate.visualPlanChecked, ['draftGate', 'visualPlanChecked'], 'compare rendered frames against the Storyboard visual plan'],
    [value.draftGate.unresolvedIssues.length === 0, ['draftGate', 'unresolvedIssues'], 'resolve draft issues before review'],
  ];
  for (const [valid, path, message] of checks) {
    if (!valid) ctx.addIssue({ code: 'custom', path, message });
  }
});

const finalReviewSchema = z.object({
  version: z.literal('1.0'),
  outputPath: mp4OutputPathSchema,
  status: z.enum(['pass', 'revise', 'fail']),
  technical: z.object({
    validContainer: z.boolean(),
    durationSeconds: z.number().positive(),
    resolution: z.string().min(3),
    fps: z.number().positive(),
    hasAudio: z.boolean(),
  }),
  visual: z.object({
    framesSampled: z.number().int().min(3),
    contactSheetPath: z.string().min(1),
    blackFramesDetected: z.boolean(),
    missingAssets: z.boolean(),
    unreadableText: z.boolean(),
    overlapDetected: z.boolean(),
    subjectNamed: z.boolean().optional(),
    storyArcComplete: z.boolean().optional(),
    endingResolves: z.boolean().optional(),
    visualPlanHonored: z.boolean(),
    underfilledFramesDetected: z.boolean(),
    subtitleNarrationVisualAligned: z.boolean(),
    subtitleVisualEvidence: z.array(subtitleVisualReviewEvidenceSchema),
  }),
  audio: z.object({
    integratedLufs: z.number().nullable().describe('Measured integrated loudness in LUFS. Use null when no measurement tool was run; never estimate.'),
    truePeakDbfs: z.number().nullable().describe('Measured true peak in dBFS. Use null when no measurement tool was run; never estimate.'),
    unexpectedSilence: z.boolean(),
    narrationPresent: z.boolean(),
    musicPresent: z.boolean(),
    soundDesignPresent: z.boolean().optional(),
    audioSupportsStory: z.boolean().optional(),
  }),
  runtimePromiseHonored: z.boolean(),
  issues: z.array(z.string()),
}).refine(value => value.status !== 'pass' || (
  value.technical.validContainer &&
  !value.visual.blackFramesDetected &&
  !value.visual.missingAssets &&
  !value.visual.unreadableText &&
  !value.visual.overlapDetected &&
  value.visual.subjectNamed !== false &&
  value.visual.storyArcComplete !== false &&
  value.visual.endingResolves !== false &&
  value.visual.visualPlanHonored &&
  value.visual.subtitleNarrationVisualAligned &&
  value.visual.subtitleVisualEvidence.every(item => item.alignment === 'pass') &&
  !value.audio.unexpectedSilence &&
  value.audio.audioSupportsStory !== false &&
  value.runtimePromiseHonored &&
  value.issues.length === 0
), { message: 'a passing review cannot contain failed checks' });

const deliverySchema = z.object({
  version: z.literal('1.0'),
  outputPath: mp4OutputPathSchema,
  editableSourcePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  deliveredAt: z.string().datetime(),
});

export const studioArtifactSchemas = {
  brief: briefSchema,
  proposal: proposalSchema,
  script: scriptSchema,
  storyboard: storyboardSchema,
  assets: assetManifestSchema,
  composition: compositionSchema,
  review: finalReviewSchema,
  delivery: deliverySchema,
} satisfies Record<StudioStageId, z.ZodType>;

export function normalizeStudioDeliveryArtifact(input: {
  candidate: unknown;
  reviewedOutputPath: string;
  compositionDesignPath: string;
  now?: string;
}): z.infer<typeof deliverySchema> {
  const candidate = input.candidate && typeof input.candidate === 'object'
    ? input.candidate as Record<string, unknown>
    : {};
  return deliverySchema.parse({
    version: '1.0',
    outputPath: input.reviewedOutputPath,
    editableSourcePath: input.compositionDesignPath,
    deliveredAt: input.now || new Date().toISOString(),
    ...(typeof candidate.sha256 === 'string' ? { sha256: candidate.sha256 } : {}),
  });
}

export function buildStudioDeliveryArtifact(input: {
  outputPath: string;
  compositionDesignPath: string;
  now?: string;
}): z.infer<typeof deliverySchema> {
  return deliverySchema.parse({
    version: '1.0',
    outputPath: input.outputPath,
    editableSourcePath: input.compositionDesignPath,
    deliveredAt: input.now || new Date().toISOString(),
  });
}

export const stageDefinitions: Record<StudioStageId, {
  dependencies: StudioStageId[];
  approvalRequired: boolean;
  artifactName: string;
}> = {
  brief: { dependencies: [], approvalRequired: false, artifactName: 'brief' },
  proposal: { dependencies: ['brief'], approvalRequired: true, artifactName: 'proposal' },
  script: { dependencies: ['proposal'], approvalRequired: true, artifactName: 'script' },
  storyboard: { dependencies: ['script'], approvalRequired: true, artifactName: 'storyboard' },
  assets: { dependencies: ['storyboard'], approvalRequired: true, artifactName: 'asset-manifest' },
  composition: { dependencies: ['assets', 'script'], approvalRequired: false, artifactName: 'composition' },
  review: { dependencies: ['composition'], approvalRequired: false, artifactName: 'final-review' },
  delivery: { dependencies: ['review'], approvalRequired: false, artifactName: 'delivery' },
};

export const artifactRefSchema = z.object({
  stage: studioStageIdSchema,
  version: z.number().int().positive(),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
});
export type StudioArtifactRef = z.infer<typeof artifactRefSchema>;

export const stageStateSchema = z.object({
  status: stageStatusSchema,
  artifactVersion: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  invalidatedBy: studioStageIdSchema.optional(),
  error: z.string().optional(),
});

export const studioDecisionSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['approval', 'selection', 'invalidation', 'override']),
  stage: studioStageIdSchema,
  summary: z.string().min(1),
  automatic: z.boolean(),
  createdAt: z.string().datetime(),
});

export const studioRunSchema = z.object({
  version: z.literal('1.0'),
  id: z.string().min(1),
  // Legacy project-scoped records may not have this field. Every newly
  // created workflow invocation is bound to its sole model-facing Agent Run.
  agentRunId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  recipe: z.string().min(1),
  title: z.string().min(1),
  approvalPolicy: approvalPolicySchema,
  status: runStatusSchema,
  currentStage: studioStageIdSchema.nullable(),
  deliveryPromise: deliveryPromiseSchema,
  stages: z.record(studioStageIdSchema, stageStateSchema),
  artifacts: z.partialRecord(studioStageIdSchema, artifactRefSchema),
  decisions: z.array(studioDecisionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type StudioRun = z.infer<typeof studioRunSchema>;

export function validateStudioArtifact(stage: StudioStageId, artifact: unknown): unknown {
  return studioArtifactSchemas[stage].parse(artifact);
}

export function getStudioArtifactJsonSchema(stage: StudioStageId): Record<string, unknown> {
  const schema = z.toJSONSchema(studioArtifactSchemas[stage], {
    target: 'draft-7',
    unrepresentable: 'any',
  });

  // Zod's generated object retains the source schema in its prototype chain.
  // Tool results must be plain JSON before AI SDK feeds them back to the model.
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}
