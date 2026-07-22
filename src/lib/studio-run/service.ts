import type { StudioRunStore } from './workspace-store';
import {
  approveStudioStage,
  completeStudioRunFromMaterialization,
  createStudioRun,
  invalidateStudioStage,
  putStudioArtifact,
} from './controller';
import {
  studioRunSchema,
  type StudioApprovalPolicy,
  type StudioDeliveryPromise,
  type StudioRun,
  type StudioStageId,
} from './contracts';
import { studioArtifactPath } from './workspace-store';

export async function startPersistedStudioRun(input: {
  id?: string;
  store: StudioRunStore;
  agentRunId: string;
  projectId: string;
  recipe: string;
  title: string;
  approvalPolicy: StudioApprovalPolicy;
  deliveryPromise: StudioDeliveryPromise;
}): Promise<StudioRun> {
  const matchingFreshRun = (await input.store.listRuns(input.projectId)).find(run => (
    run.agentRunId === input.agentRunId
    && run.status === 'running'
    && run.currentStage === 'brief'
    && Object.keys(run.artifacts).length === 0
    && run.recipe === input.recipe
    && JSON.stringify(run.deliveryPromise) === JSON.stringify(input.deliveryPromise)
  ));
  if (matchingFreshRun) {
    const run = studioRunSchema.parse({
      ...matchingFreshRun,
      title: input.title,
      approvalPolicy: input.approvalPolicy,
      updatedAt: new Date().toISOString(),
    });
    await input.store.saveRun(run);
    return run;
  }

  const run = createStudioRun(input);
  await input.store.saveRun(run);
  return run;
}

export async function putPersistedStudioArtifact(input: {
  store: StudioRunStore;
  run: StudioRun;
  stage: StudioStageId;
  artifact: unknown;
}): Promise<{ run: StudioRun; artifactPath: string; invalidated: StudioStageId[] }> {
  const nextVersion = input.run.stages[input.stage].artifactVersion + 1;
  const artifactPath = studioArtifactPath(input.run.projectId, input.run.id, input.stage, nextVersion);
  const result = putStudioArtifact({
    run: input.run,
    stage: input.stage,
    artifact: input.artifact,
    artifactPath,
  });
  await input.store.saveArtifact(result.run, input.stage, result.ref.version, result.artifact);
  await input.store.saveRun(result.run);
  return { run: result.run, artifactPath, invalidated: result.invalidated };
}

export async function putPersistedStudioArtifacts(input: {
  store: StudioRunStore;
  run: StudioRun;
  artifacts: Array<{ stage: StudioStageId; artifact: unknown }>;
}): Promise<{
  run: StudioRun;
  updates: Array<{ run: StudioRun; artifactPath: string; invalidated: StudioStageId[] }>;
}> {
  if (input.run.approvalPolicy !== 'auto') {
    throw new Error('put_artifacts is only available for auto-approved Studio Runs');
  }
  if (input.artifacts.length === 0) throw new Error('put_artifacts requires at least one artifact');

  let run = input.run;
  const prepared: Array<{
    stage: StudioStageId;
    artifactPath: string;
    result: ReturnType<typeof putStudioArtifact>;
  }> = [];
  for (const item of input.artifacts) {
    if (run.currentStage !== item.stage) {
      throw new Error(`put_artifacts must be contiguous: expected ${run.currentStage || 'complete'}, received ${item.stage}`);
    }
    const nextVersion = run.stages[item.stage].artifactVersion + 1;
    const artifactPath = studioArtifactPath(run.projectId, run.id, item.stage, nextVersion);
    const result = putStudioArtifact({
      run,
      stage: item.stage,
      artifact: item.artifact,
      artifactPath,
    });
    prepared.push({ stage: item.stage, artifactPath, result });
    run = result.run;
    if (run.status === 'failed' || run.status === 'awaiting_approval') break;
  }

  const updates: Array<{ run: StudioRun; artifactPath: string; invalidated: StudioStageId[] }> = [];
  for (const item of prepared) {
    await input.store.saveArtifact(item.result.run, item.stage, item.result.ref.version, item.result.artifact);
    await input.store.saveRun(item.result.run);
    updates.push({
      run: item.result.run,
      artifactPath: item.artifactPath,
      invalidated: item.result.invalidated,
    });
  }
  return { run, updates };
}

export async function approvePersistedStudioStage(input: {
  store: StudioRunStore;
  run: StudioRun;
  stage: StudioStageId;
  summary?: string;
}): Promise<StudioRun> {
  const run = approveStudioStage(input);
  await input.store.saveRun(run);
  return run;
}

export async function invalidatePersistedStudioStage(input: {
  store: StudioRunStore;
  run: StudioRun;
  stage: StudioStageId;
  reason: string;
}): Promise<{ run: StudioRun; invalidated: StudioStageId[] }> {
  const result = invalidateStudioStage(input);
  await input.store.saveRun(result.run);
  return result;
}

export async function completePersistedStudioRunFromMaterialization(input: {
  store: StudioRunStore;
  run: StudioRun;
  outputPath: string;
  compositionDesignPath: string;
}): Promise<{ run: StudioRun; artifactPath: string }> {
  if (input.run.status === 'completed' && input.run.artifacts.delivery) {
    return { run: input.run, artifactPath: input.run.artifacts.delivery.path };
  }
  const nextVersion = input.run.stages.delivery.artifactVersion + 1;
  const artifactPath = studioArtifactPath(input.run.projectId, input.run.id, 'delivery', nextVersion);
  const result = completeStudioRunFromMaterialization({
    run: input.run,
    outputPath: input.outputPath,
    compositionDesignPath: input.compositionDesignPath,
    artifactPath,
  });
  await input.store.saveArtifact(result.run, 'delivery', result.ref.version, result.artifact);
  await input.store.saveRun(result.run);
  return { run: result.run, artifactPath };
}

export * from './contracts';
export * from './controller';
export * from './workspace-store';
