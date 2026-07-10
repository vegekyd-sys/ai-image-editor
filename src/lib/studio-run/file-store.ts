import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudioRun, StudioStageId } from './contracts';
import { parseStudioRun } from './controller';
import {
  studioArtifactPath,
  studioRunStatePath,
  type StudioRunStore,
} from './workspace-store';

export class FileStudioRunStore implements StudioRunStore {
  constructor(private rootDir: string) {}

  private resolve(relativePath: string): string {
    return path.join(this.rootDir, ...relativePath.split('/'));
  }

  async saveRun(run: StudioRun): Promise<string> {
    const relativePath = studioRunStatePath(run.projectId, run.id);
    const target = this.resolve(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(run, null, 2));
    return relativePath;
  }

  async saveArtifact(run: StudioRun, stage: StudioStageId, version: number, artifact: unknown): Promise<string> {
    const relativePath = studioArtifactPath(run.projectId, run.id, stage, version);
    const target = this.resolve(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(artifact, null, 2));
    return relativePath;
  }

  async loadRun(projectId: string, runId: string): Promise<StudioRun | null> {
    try {
      return parseStudioRun(await readFile(this.resolve(studioRunStatePath(projectId, runId)), 'utf8'));
    } catch {
      return null;
    }
  }

  async listRuns(projectId: string): Promise<StudioRun[]> {
    const directory = this.resolve(`${projectId}/studio-runs`);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const runs = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => this.loadRun(projectId, entry.name)));
      return runs.filter((run): run is StudioRun => !!run).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }
}
