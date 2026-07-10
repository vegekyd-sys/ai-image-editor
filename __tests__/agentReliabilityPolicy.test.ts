import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('agent reliability policy', () => {
  it('raises the normal agent budget while keeping an environment override', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain("process.env.AGENT_MAX_STEPS");
    expect(agent).toContain(': 60;');
    expect(agent).toContain('Math.min(120, Math.max(30, configuredMaxSteps))');
  });

  it('autosaves every successful composition render and patch', () => {
    const agent = read('src/lib/agent.ts');
    const coding = read('src/lib/prompts/agent-coding.md');
    expect(agent.match(/persistCompositionDraft\(\{/g)).toHaveLength(2);
    expect(agent).toContain('code_path: autosave.path');
    expect(agent).toContain('design_path: z.string().optional()');
    expect(agent).not.toContain('Draft is not saved yet');
    expect(coding).toContain('immediately autosaved to the workspace recovery path');
  });

  it('exposes Studio Run stage schemas and validation without persisting', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain("'schema', 'validate'");
    expect(agent).toContain('currentStageSchema');
    expect(agent).toContain('getStudioArtifactJsonSchema');
    expect(agent).toContain("operation === 'validate'");
  });

  it('supports batched auto-approved planning without hiding stage events', () => {
    const agent = read('src/lib/agent.ts');
    const writer = read('src/lib/agentDualWriter.ts');
    const contract = read('src/skills/_shared/studio-production/production-contract.md');
    const fastPath = read('src/lib/prompts/studio-remotion-fast-path.md');
    const review = read('src/skills/_shared/studio-production/review-contract.md');
    expect(agent).toContain("'put_artifacts'");
    expect(agent).toContain('putPersistedStudioArtifacts');
    expect(agent).toContain('stageSchemas: Object.fromEntries');
    expect(agent).toContain('output.stageSchemas');
    expect(writer).toContain('studioRunUpdates');
    expect(contract).toContain('Reuse the complete `stageSchemas`');
    expect(contract).toContain('preview three representative frames');
    expect(contract).toContain('Do not add a fourth preview');
    expect(contract).toContain('Do not compute SHA');
    expect(fastPath).toContain('replaces `prompts/agent-coding.md`');
    expect(fastPath).toContain('materialize once');
    expect(review).toContain('sample at least three frames');
    expect(review).toContain('videos longer than 15');
  });
});
