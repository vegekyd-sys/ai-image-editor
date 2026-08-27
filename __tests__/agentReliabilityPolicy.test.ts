import { describe, expect, it } from 'vitest';
import { readAgentAwareSource } from './helpers/agentRuntimeSource';

const root = process.cwd();
const read = (file: string) => readAgentAwareSource(root, file);

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

  it('drains durable attempt budgets at completed step boundaries instead of killing active code streams', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain('attemptBudgetReached = true');
    expect(agent).toContain("code: 'attempt_budget_handoff'");
    expect(agent).toContain('chunkMs: streamIdleTimeoutMs');
    expect(agent).not.toContain('totalMs: remainingInvocationBudgetMs');
    expect(agent).not.toContain('toolMs: Math.min(900_000, remainingInvocationBudgetMs)');
  });

  it('auto-assembles numbered composition files and exposes write_file source progress', () => {
    const agent = read('src/lib/agent.ts');
    const runner = read('src/lib/composition-workspace-runner.ts');
    expect(agent).toContain('compileSavedCompositionPart');
    expect(agent).toContain("toolName: 'run_code' | 'write_code_file' | 'write_file'");
    expect(agent).toContain('compositionWorkspace.status="ready"');
    expect(agent).toContain('Do not call run_code merely to assemble files');
    expect(agent).toContain("checkpoint.streamedCodePath");
    expect(agent).toContain("codeExtractor.toolCallId");
    expect(runner).toContain('Persist registration before compiling');
    expect(runner).toContain('persistCompositionDraft');
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
    expect(agent).toContain('include_stage_schemas');
    expect(agent).toContain("planningMode: 'creative-packet'");
    expect(agent).toContain("operation === 'put_creative_packet'");
    expect(agent).toContain('buildStudioCreativeArtifacts');
    expect(agent).toContain('output.stageSchemas');
    expect(writer).toContain('studioRunUpdates');
    expect(contract).toContain('Do not request all eight stage schemas');
    expect(contract).toContain('put_creative_packet');
    expect(contract).toContain('Composition draft gate');
    expect(contract).toContain('every scene boundary');
    expect(contract).toContain('durable worker automatically completes Review');
    expect(contract).toContain('do not author Review');
    expect(contract).toContain('`prompts/remotion-composition.md`');
    expect(contract).toContain('`skills/_shared/remotion-director-contract.md`');
    expect(contract).toContain('does not replace or');
    expect(agent).toContain('same original Composition and Director guidance');
    expect(composition).toContain('## Composition Quality');
    expect(director).toContain('## Anti-Web Rules');
    expect(contract).toContain('Do not compute SHA');
    expect(contract).toContain('materialize it once');
    expect(review).toContain('## Composition Review Loop');
    expect(review).toContain('generic hook/body/end sample is insufficient');
    expect(agent).not.toContain('hydrateCaptionCueProps');
    expect(agent).not.toContain('captionCuePath');
    expect(agent).not.toContain('__lastCaptionCuePath');
    expect(agent).not.toContain("`${ctx.projectId}/captions/*.json`");
    expect(contract).toContain('author them as part of the Composition');
    expect(contract).toContain('narration cue sheet standardizes measured timing only');
    expect(contract).toContain('does not inject caption JSX');
    expect(composition).toContain('authored directly inside this');
    expect(composition).toContain('does not provide a universal subtitle overlay');
  });

  it('stops repeated MP4 export attempts for an unchanged composition', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain('materializeAttempts?: Map<string, number>');
    expect(agent).toContain('attemptCount >= 2');
    expect(agent).toContain('Do not call materialize_media again');
    expect(agent).toContain(".select('design_path')");
  });

  it('queues corrected composition exports and derives resolution from typed Studio state', () => {
    const agent = read('src/lib/agent.ts');
    const nonRepeatable = agent.slice(
      agent.indexOf('const nonRepeatableTools = new Set(['),
      agent.indexOf(']);', agent.indexOf('const nonRepeatableTools = new Set([')),
    );
    expect(nonRepeatable).not.toContain("'materialize_media'");
    expect(agent).not.toContain('wait: z.boolean()');
    expect(agent).not.toContain("profile: z.enum(['fast_720p', 'source'])");
    expect(agent).toContain("studioCheckpoint.studioRunId\n            ? 'source'\n            : 'fast_720p'");
    expect(agent).toContain('studioRunId: studioCheckpoint.studioRunId');
    expect(agent).toContain('shouldPreferLatestDraft');
    expect(agent).toContain('design_path: shouldPreferLatestDraft ? latestDraftPath : design_path');
  });

  it('returns a pending video snapshot while the durable worker finishes Studio delivery', () => {
    const agent = read('src/lib/agent.ts');
    const exporter = read('src/lib/remotion-export.ts');
    expect(agent).toContain("status: job.status === 'completed' && job.storage_url ? 'completed' : 'processing'");
    expect(agent).toContain("taskId: `remotion-export-pending-${job.id}`");
    expect(agent).toContain('studioRunPending: Boolean(studioCheckpoint.studioRunId)');
    expect(exporter).toContain('completeStudioRunForExport(updated as RemotionExportJob)');
  });
});
