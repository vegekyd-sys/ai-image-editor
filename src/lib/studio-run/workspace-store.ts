import type { SupabaseClient } from '@supabase/supabase-js';
import * as workspace from '@/lib/workspace';
import { stageDefinitions, type StudioRun, type StudioStageId } from './contracts';
import { parseStudioRun } from './controller';

function runRoot(projectId: string, runId: string): string {
  return `${projectId}/studio-runs/${runId}`;
}

export function studioRunStatePath(projectId: string, runId: string): string {
  return `${runRoot(projectId, runId)}/run.json`;
}

export function studioArtifactPath(projectId: string, runId: string, stage: StudioStageId, version: number): string {
  return `${runRoot(projectId, runId)}/artifacts/${stageDefinitions[stage].artifactName}.v${version}.json`;
}

export interface StudioRunStore {
  saveRun(run: StudioRun): Promise<string>;
  saveArtifact(run: StudioRun, stage: StudioStageId, version: number, artifact: unknown): Promise<string>;
  loadRun(projectId: string, runId: string): Promise<StudioRun | null>;
  listRuns(projectId: string): Promise<StudioRun[]>;
}

export class WorkspaceStudioRunStore implements StudioRunStore {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  async saveRun(run: StudioRun): Promise<string> {
    const path = studioRunStatePath(run.projectId, run.id);
    const result = await workspace.writeFile(
      path,
      JSON.stringify(run, null, 2),
      this.supabase,
      this.userId,
      'application/json',
    );
    if (!result.success) throw new Error(result.error || `Failed to save Studio Run ${run.id}`);
    return path;
  }

  async saveArtifact(run: StudioRun, stage: StudioStageId, version: number, artifact: unknown): Promise<string> {
    const path = studioArtifactPath(run.projectId, run.id, stage, version);
    const result = await workspace.writeFile(
      path,
      JSON.stringify(artifact, null, 2),
      this.supabase,
      this.userId,
      'application/json',
    );
    if (!result.success) throw new Error(result.error || `Failed to save Studio Run artifact ${stage}`);
    return path;
  }

  async loadRun(projectId: string, runId: string): Promise<StudioRun | null> {
    const result = await workspace.readFile(studioRunStatePath(projectId, runId), this.supabase, this.userId);
    return result ? parseStudioRun(result.content) : null;
  }

  async listRuns(projectId: string): Promise<StudioRun[]> {
    const files = await workspace.listFiles(`${projectId}/studio-runs/*/run.json`, this.supabase, this.userId);
    const runs = await Promise.all(files.filter(file => !file.isBuiltIn).map(async file => {
      const result = await workspace.readFile(file.path, this.supabase, this.userId);
      if (!result) return null;
      try {
        return parseStudioRun(result.content);
      } catch {
        return null;
      }
    }));
    return runs.filter((run): run is StudioRun => !!run).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
