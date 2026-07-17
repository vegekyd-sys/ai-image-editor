import { describe, expect, it } from 'vitest';
import { buildTurnMediaInspectionContext } from '@/lib/agent-context';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('current upload batch inspection', () => {
  it('maps the complete trailing upload batch to exact image and video tools', () => {
    const context = buildTurnMediaInspectionContext([
      { type: 'image' },
      { type: 'composition' },
      { type: 'image' },
      { type: 'image' },
      { type: 'video' },
      { type: 'image' },
      { type: 'video' },
    ], 5);

    expect(context).not.toContain('<<<media_1>>>');
    expect(context).not.toContain('<<<media_2>>>');
    expect(context).toContain('<<<media_3>>>: image — attached directly to this request as upload-batch image attachment 1');
    expect(context).toContain('<<<media_5>>>: video — inspect with analyze_video');
    expect(context).toContain('<<<media_7>>>: video — inspect with analyze_video');
    expect(context).toContain('call analyze_video once with every required media index in media_indices');
    expect(context).toContain('do not spend separate tool rounds calling analyze_image');
    expect(context).toContain('reuse the durable checkpoint, persisted descriptions, and agent_tool_history');
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

  it('carries the batch contract through CUI, durable creation, and only the first attempt', () => {
    const editor = read('src/components/Editor.tsx');
    const stream = read('src/lib/agentStream.ts');
    const route = read('src/app/api/agent/run/route.ts');
    const runner = read('src/lib/agent-execution-runner.ts');
    const cli = read('packages/makaron-cli/bin/makaron.mjs');
    const agent = read('src/lib/agent.ts');

    expect(editor).toContain('turnMediaCount: (imgs?.length || 0) + (videos?.length || 0)');
    expect(editor).toContain('turnMediaCount: workSnapshots.length');
    expect(stream).toContain('turnMediaCount: body.turnMediaCount');
    expect(route).toContain('turnMediaCount');
    expect(runner).toContain('const needsTurnMediaInspection = !continuation || !previousSnapshot');
    expect(runner).toContain('turnMediaCount: needsTurnMediaInspection ? request.turnMediaCount : undefined');
    expect(cli).toContain('uploadedTurnMediaCount += addedCount');
    expect(cli).toContain('turnMediaCount: uploadedTurnMediaCount');
    expect(agent).toContain('inspectionImages?: string[]');
    expect(agent).toContain("return { mode: 'batch_describe', analyses }");
  });
});
