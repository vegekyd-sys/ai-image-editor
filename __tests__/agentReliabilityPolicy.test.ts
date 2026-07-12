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
    expect(agent.match(/__lastSavedDraftPath = autosave\.path/g)).toHaveLength(2);
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
    const composition = read('src/lib/prompts/remotion-composition.md');
    const director = read('src/skills/_shared/remotion-director-contract.md');
    const review = read('src/skills/_shared/studio-production/review-contract.md');
    expect(agent).toContain("'put_artifacts'");
    expect(agent).toContain('putPersistedStudioArtifacts');
    expect(agent).toContain('stageSchemas: Object.fromEntries');
    expect(agent).toContain('output.stageSchemas');
    expect(writer).toContain('studioRunUpdates');
    expect(contract).toContain('Reuse the complete `stageSchemas`');
    expect(contract).toContain('Composition draft gate');
    expect(contract).toContain('every scene boundary');
    expect(contract).toContain('only persists the already-reviewed paths');
    expect(contract).toContain('`prompts/remotion-composition.md`');
    expect(contract).toContain('`skills/_shared/remotion-director-contract.md`');
    expect(contract).toContain('does not replace or');
    expect(agent).toContain('same original Composition and Director guidance');
    expect(composition).toContain('## Composition Quality');
    expect(director).toContain('## Anti-Web Rules');
    expect(contract).toContain('Do not compute SHA');
    expect(contract).toContain('materialize it once');
    expect(review).toContain('## Composition Draft Gate');
    expect(review).toContain('generic hook/body/end sample is not enough');
  });

  it('stops repeated MP4 export attempts for an unchanged composition', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain('materializeAttempts?: Map<string, number>');
    expect(agent).toContain('attemptCount >= 2');
    expect(agent).toContain('Do not call materialize_media again');
    expect(agent).toContain(".select('design_path')");
  });

  it('keeps corrected composition exports available across recovery and out of delivery', () => {
    const agent = read('src/lib/agent.ts');
    const nonRepeatable = agent.slice(
      agent.indexOf('const nonRepeatableTools = new Set(['),
      agent.indexOf(']);', agent.indexOf('const nonRepeatableTools = new Set([')),
    );
    expect(nonRepeatable).not.toContain("'materialize_media'");
    expect(agent).toContain("studioCheckpoint.studioRunStage === 'delivery'");
    expect(agent).toContain('shouldPreferLatestDraft');
    expect(agent).toContain('design_path: shouldPreferLatestDraft ? latestDraftPath : design_path');
  });

  it('returns the exact published video media index for final review', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain('ctx.snapshotImages.push(videoUrl)');
    expect(agent).toContain('mediaIndex: publishedMediaIndex');
    expect(agent).toContain('Use media_index=${publishedMediaIndex} for final video review.');
  });
});
