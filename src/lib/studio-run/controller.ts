import { createHash, randomUUID } from 'node:crypto';
import {
  STUDIO_STAGE_IDS,
  stageDefinitions,
  studioRunSchema,
  type StudioApprovalPolicy,
  type StudioArtifactRef,
  type StudioDeliveryPromise,
  type StudioRun,
  type StudioStageId,
  validateStudioArtifact,
} from './contracts';

function iso(now: Date | string = new Date()): string {
  return typeof now === 'string' ? now : now.toISOString();
}

function hashArtifact(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function firstOpenStage(run: StudioRun): StudioStageId | null {
  return STUDIO_STAGE_IDS.find(stage => !['completed', 'awaiting_approval'].includes(run.stages[stage].status)) ?? null;
}

function descendantsOf(stage: StudioStageId): StudioStageId[] {
  const descendants = new Set<StudioStageId>();
  const visit = (candidate: StudioStageId) => {
    for (const next of STUDIO_STAGE_IDS) {
      if (stageDefinitions[next].dependencies.includes(candidate) && !descendants.has(next)) {
        descendants.add(next);
        visit(next);
      }
    }
  };
  visit(stage);
  return STUDIO_STAGE_IDS.filter(candidate => descendants.has(candidate));
}

function updateRunStatus(run: StudioRun, now: string): StudioRun {
  const awaiting = STUDIO_STAGE_IDS.find(stage => run.stages[stage].status === 'awaiting_approval');
  const failed = STUDIO_STAGE_IDS.find(stage => run.stages[stage].status === 'failed');
  const currentStage = awaiting ?? firstOpenStage(run);
  const completed = STUDIO_STAGE_IDS.every(stage => run.stages[stage].status === 'completed');
  const { completedAt: _completedAt, ...activeRun } = run;
  return {
    ...activeRun,
    currentStage: completed ? null : currentStage,
    status: completed ? 'completed' : failed ? 'failed' : awaiting ? 'awaiting_approval' : 'running',
    updatedAt: now,
    ...(completed ? { completedAt: now } : {}),
  };
}

function nearlyEqual(actual: number, expected: number, tolerance = 0.05): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function assertArtifactHonorsDeliveryPromise(run: StudioRun, stage: StudioStageId, artifact: unknown): void {
  const value = artifact as Record<string, any>;
  const promise = run.deliveryPromise;
  const mismatch = (field: string): never => {
    throw new Error(`${stage} does not honor delivery promise: ${field}`);
  };

  if (stage === 'brief' && !nearlyEqual(value.durationSeconds, promise.durationSeconds)) mismatch('durationSeconds');
  if (stage === 'proposal' && JSON.stringify(value.deliveryPromise) !== JSON.stringify(promise)) mismatch('deliveryPromise');
  if (stage === 'script' && !nearlyEqual(value.totalDurationSeconds, promise.durationSeconds)) mismatch('totalDurationSeconds');
  if (stage === 'storyboard') {
    const lastScene = value.scenes[value.scenes.length - 1];
    if (!nearlyEqual(lastScene.endSeconds, promise.durationSeconds)) mismatch('scene duration');
  }
  if (stage === 'assets' && promise.audioRequired) {
    const hasAudioAsset = value.assets.some((asset: { type?: string }) => (
      asset.type === 'audio' || asset.type === 'music'
    ));
    if (!hasAudioAsset) mismatch('required audio asset');
  }
  if (stage === 'composition') {
    if (value.runtime !== promise.renderRuntime) mismatch('runtime');
    if (value.mode !== promise.compositionMode) mismatch('composition mode');
    if (value.width !== promise.width || value.height !== promise.height) mismatch('resolution');
    if (!nearlyEqual(value.fps, promise.fps)) mismatch('fps');
    if (!nearlyEqual(value.durationSeconds, promise.durationSeconds)) mismatch('durationSeconds');
    if (promise.compositionMode === 'editable' && !value.editable) mismatch('editable');
  }
  if (stage === 'review' && value.status === 'pass') {
    if (!nearlyEqual(value.technical.durationSeconds, promise.durationSeconds, Math.max(0.1, 2 / promise.fps))) mismatch('review duration');
    if (value.technical.resolution !== `${promise.width}x${promise.height}`) mismatch('review resolution');
    if (!nearlyEqual(value.technical.fps, promise.fps)) mismatch('review fps');
    if (promise.audioRequired && !value.technical.hasAudio) mismatch('required audio');
  }
}

export function createStudioRun(input: {
  id?: string;
  projectId: string;
  recipe: string;
  title: string;
  approvalPolicy: StudioApprovalPolicy;
  deliveryPromise: StudioDeliveryPromise;
  now?: Date | string;
}): StudioRun {
  const now = iso(input.now);
  const stages = Object.fromEntries(STUDIO_STAGE_IDS.map((stage, index) => [
    stage,
    {
      status: index === 0 ? 'in_progress' : 'pending',
      artifactVersion: 0,
      updatedAt: now,
    },
  ])) as StudioRun['stages'];

  return studioRunSchema.parse({
    version: '1.0',
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    recipe: input.recipe,
    title: input.title,
    approvalPolicy: input.approvalPolicy,
    status: 'running',
    currentStage: 'brief',
    deliveryPromise: input.deliveryPromise,
    stages,
    artifacts: {},
    decisions: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function putStudioArtifact(input: {
  run: StudioRun;
  stage: StudioStageId;
  artifact: unknown;
  artifactPath: string;
  now?: Date | string;
}): { run: StudioRun; artifact: unknown; ref: StudioArtifactRef; invalidated: StudioStageId[] } {
  const now = iso(input.now);
  const run = studioRunSchema.parse(structuredClone(input.run));
  const artifact = validateStudioArtifact(input.stage, input.artifact);
  assertArtifactHonorsDeliveryPromise(run, input.stage, artifact);
  const dependencies = stageDefinitions[input.stage].dependencies;
  const unmet = dependencies.filter(stage => run.stages[stage].status !== 'completed');
  if (unmet.length) {
    throw new Error(`Cannot write ${input.stage}: incomplete dependencies ${unmet.join(', ')}`);
  }

  const invalidated = descendantsOf(input.stage).filter(stage => (
    run.stages[stage].artifactVersion > 0 ||
    ['completed', 'awaiting_approval'].includes(run.stages[stage].status)
  ));
  for (const stage of invalidated) {
    run.stages[stage] = {
      status: 'invalidated',
      artifactVersion: run.stages[stage].artifactVersion,
      updatedAt: now,
      invalidatedBy: input.stage,
    };
    delete run.artifacts[stage];
  }

  const nextVersion = run.stages[input.stage].artifactVersion + 1;
  const ref: StudioArtifactRef = {
    stage: input.stage,
    version: nextVersion,
    path: input.artifactPath,
    sha256: hashArtifact(artifact),
    createdAt: now,
  };
  const approvalRequired = stageDefinitions[input.stage].approvalRequired;
  const automaticallyApproved = approvalRequired && run.approvalPolicy === 'auto';
  const reviewFailed = input.stage === 'review' && (artifact as { status: string }).status !== 'pass';
  const status = reviewFailed ? 'failed' : approvalRequired && !automaticallyApproved ? 'awaiting_approval' : 'completed';
  run.stages[input.stage] = {
    status,
    artifactVersion: nextVersion,
    updatedAt: now,
    ...(reviewFailed ? { error: `Final review status: ${(artifact as { status: string }).status}` } : {}),
    ...((status === 'completed' && approvalRequired) ? { approvedAt: now } : {}),
  };
  run.artifacts[input.stage] = ref;

  if (automaticallyApproved) {
    run.decisions.push({
      id: randomUUID(),
      category: 'approval',
      stage: input.stage,
      summary: `Automatically approved ${stageDefinitions[input.stage].artifactName} under run policy`,
      automatic: true,
      createdAt: now,
    });
  }
  if (invalidated.length) {
    run.decisions.push({
      id: randomUUID(),
      category: 'invalidation',
      stage: input.stage,
      summary: `Invalidated downstream stages: ${invalidated.join(', ')}`,
      automatic: true,
      createdAt: now,
    });
  }

  return { run: studioRunSchema.parse(updateRunStatus(run, now)), artifact, ref, invalidated };
}

export function approveStudioStage(input: {
  run: StudioRun;
  stage: StudioStageId;
  summary?: string;
  now?: Date | string;
}): StudioRun {
  const now = iso(input.now);
  const run = studioRunSchema.parse(structuredClone(input.run));
  if (run.stages[input.stage].status !== 'awaiting_approval') {
    throw new Error(`Stage ${input.stage} is not awaiting approval`);
  }
  run.stages[input.stage] = {
    ...run.stages[input.stage],
    status: 'completed',
    approvedAt: now,
    updatedAt: now,
  };
  run.decisions.push({
    id: randomUUID(),
    category: 'approval',
    stage: input.stage,
    summary: input.summary || `Approved ${stageDefinitions[input.stage].artifactName}`,
    automatic: false,
    createdAt: now,
  });
  return studioRunSchema.parse(updateRunStatus(run, now));
}

export function invalidateStudioStage(input: {
  run: StudioRun;
  stage: StudioStageId;
  reason: string;
  now?: Date | string;
}): { run: StudioRun; invalidated: StudioStageId[] } {
  const now = iso(input.now);
  const run = studioRunSchema.parse(structuredClone(input.run));
  const invalidated = [input.stage, ...descendantsOf(input.stage)].filter(stage => (
    run.stages[stage].artifactVersion > 0 || run.stages[stage].status !== 'pending'
  ));
  for (const stage of invalidated) {
    run.stages[stage] = {
      status: 'invalidated',
      artifactVersion: run.stages[stage].artifactVersion,
      updatedAt: now,
      invalidatedBy: input.stage,
    };
    delete run.artifacts[stage];
  }
  run.stages[input.stage] = {
    ...run.stages[input.stage],
    status: 'in_progress',
    updatedAt: now,
  };
  run.decisions.push({
    id: randomUUID(),
    category: 'invalidation',
    stage: input.stage,
    summary: input.reason,
    automatic: false,
    createdAt: now,
  });
  return { run: studioRunSchema.parse(updateRunStatus(run, now)), invalidated };
}

export function parseStudioRun(serialized: string): StudioRun {
  return studioRunSchema.parse(JSON.parse(serialized));
}

export function summarizeStudioRun(run: StudioRun, artifactPath?: string) {
  return {
    runId: run.id,
    projectId: run.projectId,
    title: run.title,
    recipe: run.recipe,
    status: run.status,
    currentStage: run.currentStage,
    approvalPolicy: run.approvalPolicy,
    stages: STUDIO_STAGE_IDS.map(stage => ({
      id: stage,
      status: run.stages[stage].status,
      artifactVersion: run.stages[stage].artifactVersion,
      artifactPath: run.artifacts[stage]?.path,
      artifactCreatedAt: run.artifacts[stage]?.createdAt,
      stageUpdatedAt: run.stages[stage].updatedAt,
    })),
    artifactPath,
    updatedAt: run.updatedAt,
  };
}
