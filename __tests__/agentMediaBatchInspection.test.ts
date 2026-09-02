import { describe, expect, it } from 'vitest';
import { buildTurnMediaInspectionContext } from '@/lib/agent-context';
import { readAgentAwareSource } from './helpers/agentRuntimeSource';

const read = (path: string) => readAgentAwareSource(process.cwd(), path);

describe('current upload batch inspection', () => {
  it('tells multimodal Agents that still images are attached to the same request', () => {
    const context = buildTurnMediaInspectionContext([
      { type: 'image' },
      { type: 'composition' },
      { type: 'image' },
      { type: 'image' },
      { type: 'video' },
      { type: 'image' },
      { type: 'video' },
    ], 5, true);

    expect(context).not.toContain('<<<media_1>>>');
    expect(context).not.toContain('<<<media_2>>>');
    expect(context).toContain('<<<media_3>>>: image');
    expect(context).toContain('<<<media_5>>>: video');
    expect(context).toContain('<<<media_7>>>: video');
    expect(context).toContain('Every still image below is attached to this same Agent request');
    expect(context).toContain('Videos are not image attachments');
    expect(context).not.toContain('A verified evidence block for this exact batch follows below');
  });

  it('keeps verified bridge evidence for text-only Agents', () => {
    const context = buildTurnMediaInspectionContext([
      { type: 'image' },
      { type: 'video' },
    ], 2, false);

    expect(context).toContain('A verified evidence block for this exact batch follows below');
    expect(context).not.toContain('attached to this same Agent request');
  });

  it('does not add an inspection pass when this turn uploaded no media', () => {
    expect(buildTurnMediaInspectionContext([{ type: 'image' }], 0)).toBe('');
    expect(buildTurnMediaInspectionContext([{ type: 'image' }], undefined)).toBe('');
  });

  it('clamps the batch size to the available timeline items', () => {
    const context = buildTurnMediaInspectionContext([
      { type: 'image' },
      { type: 'video' },
    ], 99);

    expect(context).toContain('The user added 2 new Media Index items');
    expect(context).toContain('<<<media_1>>>');
    expect(context).toContain('<<<media_2>>>');
  });

  it('carries the batch contract through every entry and durable retry', () => {
    const editor = read('src/components/Editor.tsx');
    const stream = read('src/lib/agentStream.ts');
    const route = read('src/app/api/agent/run/route.ts');
    const runner = read('src/lib/agent-execution-runner.ts');
    const cli = read('packages/makaron-cli/bin/makaron.mjs');
    const agent = read('src/lib/agent.ts');
    const context = read('src/lib/agent-context.ts');
    const execution = read('src/lib/agent-execution.ts');

    expect(editor).toContain('turnMediaCount: (imgs?.length || 0) + (videos?.length || 0)');
    expect(editor).toContain('turnMediaCount: workSnapshots.length');
    expect(stream).toContain('turnMediaCount: body.turnMediaCount');
    expect(route).toContain('turnMediaCount');
    expect(runner).toContain('turnMediaCount: request.turnMediaCount');
    expect(cli).toContain('uploadedTurnMediaCount += addedCount');
    expect(cli).toContain('turnMediaCount: uploadedTurnMediaCount');
    expect(context).toContain('options.supportsImageInput === true');
    expect(context).toContain(".filter(({ snapshot }) => !supportsImageInput || snapshot.type === 'video')");
    expect(context).toContain('analyzeImageContent(');
    expect(context).toContain('analyzeVideoContent(');
    expect(context).toContain("[Verified current upload ${supportsImageInput ? 'video ' : ''}evidence");
    expect(context).toContain('[turn-media-preflight] completed ${evidenceBatch.length} items');
    expect(context).toContain('nativeVisionImages');
    expect(context).toContain('selectNativeVisionImages');
    expect(context).toContain('uploadedVideoCount && !options.turnMediaCount');
    expect(agent).toContain('nativeVisionImages?: NativeVisionImageInput[]');
    expect(agent).toContain('buildNativeVisionUserContent(');
    expect(agent).toContain('nativeImageAnalysis');
    expect(agent).toContain("return { mode: 'batch_describe', analyses }");
    expect(editor).toContain('First-turn media understanding (no user prompt)');
    expect(editor).toContain('turnMediaCount: workSnapshots.length');
    expect(editor).not.toContain('workSnapshots.map(snap => runAutoAnalysis');
    expect(execution).toContain(".eq('run_id', runId)");
  });
});
