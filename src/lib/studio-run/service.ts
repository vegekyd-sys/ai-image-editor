import type { StudioRunStore } from './workspace-store';
import {
  approveStudioStage,
  createStudioRun,
  invalidateStudioStage,
  putStudioArtifact,
} from './controller';
import {
  type StudioApprovalPolicy,
  type StudioDeliveryPromise,
  type StudioRun,
  type StudioStageId,
} from './contracts';
import { studioArtifactPath } from './workspace-store';

export async function startPersistedStudioRun(input: {
  id?: string;
  store: StudioRunStore;
  projectId: string;
  recipe: string;
  title: string;
  approvalPolicy: StudioApprovalPolicy;
  deliveryPromise: StudioDeliveryPromise;
}): Promise<StudioRun> {
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

export * from './contracts';
export * from './controller';
export * from './workspace-store';
