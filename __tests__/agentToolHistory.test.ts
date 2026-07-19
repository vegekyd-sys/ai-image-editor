import { describe, expect, it } from 'vitest';
import {
  buildModelHistoryFromRows,
  sanitizeToolHistory,
  TOOL_HISTORY_MAX_OUTPUT_CHARS,
} from '../src/lib/agentToolHistory';

describe('agent tool history sanitizer', () => {
  it('keeps markdown read_file content but caps it', () => {
    const md = `${'a'.repeat(TOOL_HISTORY_MAX_OUTPUT_CHARS + 1_000)}data:image/png;base64,abcd`;
    const result = sanitizeToolHistory(
      'read_file',
      { path: 'prompts/enhance.md' },
      { path: 'prompts/enhance.md', type: 'text/markdown', content: md },
      { rows: 0, chars: 0 },
    );

    expect(result.output.type).toBe('text');
    expect(JSON.stringify(result.output)).toContain('[prompts/enhance.md]');
    expect(JSON.stringify(result.output)).not.toContain('data:image');
    expect(result.outputChars).toBeLessThanOrEqual(TOOL_HISTORY_MAX_OUTPUT_CHARS + 500);
    expect(result.omitted).toContain('truncated_read_file');
    expect(result.omitted).toContain('removed_data_url_image');
  });

  it('removes media payloads from image read_file results', () => {
    const result = sanitizeToolHistory(
      'read_file',
      { path: 'skills/foo/assets/ref.png' },
      { path: 'skills/foo/assets/ref.png', mimeType: 'image/png', base64Data: 'x'.repeat(50_000) },
      { rows: 0, chars: 0 },
    );

    const json = JSON.stringify(result);
    expect(json).toContain('skills/foo/assets/ref.png');
    expect(json).not.toContain('x'.repeat(100));
    expect(result.omitted).toContain('removed_media_file_content');
  });

  it('compacts preview_frame and generated image outputs', () => {
    const preview = sanitizeToolHistory(
      'preview_frame',
      { frame: 12 },
      { workspaceUrl: 'https://example.com/frame.jpg', source: 'video', analysis: 'Subjects are fully visible.', base64Data: 'data:image/jpeg;base64,' + 'a'.repeat(100_000) },
      { rows: 0, chars: 0 },
    );
    const image = sanitizeToolHistory(
      'generate_image',
      { editPrompt: 'make it cinematic', image: 'data:image/png;base64,' + 'b'.repeat(100_000), base64Data: 'd'.repeat(100_000) },
      { success: true, message: 'Image generated successfully.', image: 'data:image/png;base64,' + 'c'.repeat(100_000), base64Data: 'e'.repeat(100_000) },
      { rows: 0, chars: 0 },
    );

    expect(JSON.stringify(preview)).toContain('https://example.com/frame.jpg');
    expect(JSON.stringify(preview)).toContain('video');
    expect(JSON.stringify(preview)).toContain('Subjects are fully visible.');
    expect(JSON.stringify(preview)).not.toContain('base64');
    expect(preview.omitted).toContain('removed_preview_frame_pixels');
    expect(JSON.stringify(image)).toContain('Image generated successfully.');
    expect(JSON.stringify(image)).not.toContain('data:image');
    expect(JSON.stringify(image)).not.toContain('base64Data');
    expect(image.omitted).toContain('removed_image');
    expect(image.omitted).toContain('removed_binary_payload');
  });

  it('preserves preview_frame errors instead of treating them as image pixels', () => {
    const preview = sanitizeToolHistory(
      'preview_frame',
      { design_path: 'project/drafts/latest-composition.json', frames: [0, 90, 180] },
      { error: 'Failed to capture contact sheet: Failed to compile design code' },
      { rows: 0, chars: 0 },
    );

    expect(preview.output.type).toBe('error-text');
    expect(JSON.stringify(preview.output)).toContain('Failed to compile design code');
    expect(preview.omitted).not.toContain('removed_preview_frame_pixels');
  });

  it('removes unlabelled large base64 strings while preserving useful data objects', () => {
    const result = sanitizeToolHistory(
      'custom_tool',
      { payload: 'a'.repeat(8_192), data: { assetId: 'asset-1', width: 1280 } },
      { screenshotBytes: 'b'.repeat(8_192), data: { snapshotId: 'snap-1' } },
      { rows: 0, chars: 0 },
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain('a'.repeat(100));
    expect(json).not.toContain('b'.repeat(100));
    expect(json).toContain('asset-1');
    expect(json).toContain('snap-1');
    expect(result.omitted).toContain('removed_base64_payload');
  });

  it('keeps compact tool evidence after hundreds of calls in one run', () => {
    const result = sanitizeToolHistory(
      'read_file',
      { path: 'prompts/animate.md' },
      { path: 'prompts/animate.md', type: 'text/markdown', content: 'full prompt' },
      { rows: 500, chars: 8_000_000 },
    );

    expect(JSON.stringify(result.output)).toContain('full prompt');
    expect(result.omitted).not.toContain('run_budget_exceeded');
  });

  it('keeps write_file path without storing composition code', () => {
    const result = sanitizeToolHistory(
      'write_file',
      { fromLastRunCode: true, name: 'travel-vlog' },
      {
        success: true,
        message: 'Saved: code/snapshot-123.json',
        path: 'code/snapshot-123.json',
        storageUrl: 'https://cdn.example.com/code/snapshot-123.json',
        code: 'function Composition() { return "very large source"; }',
      },
      { rows: 0, chars: 0 },
    );

    const json = JSON.stringify(result.output);
    expect(json).toContain('code/snapshot-123.json');
    expect(json).toContain('https://cdn.example.com/code/snapshot-123.json');
    expect(json).not.toContain('function Composition');
  });

  it('stores write_code_file as a workspace pointer instead of replaying source', () => {
    const source = `function Composition() { return '${'scene'.repeat(8_000)}'; }`;
    const result = sanitizeToolHistory(
      'write_code_file',
      {
        description: 'Build the complete illustrated timeline',
        path: 'project-1/code/illustrated-timeline.js',
        runtime: 'composition',
        content: source,
      },
      {
        success: true,
        path: 'project-1/code/illustrated-timeline.js',
        message: 'Code file saved',
        codeChars: source.length,
      },
      { rows: 0, chars: 0 },
    );

    const json = JSON.stringify(result);
    expect(json).toContain('project-1/code/illustrated-timeline.js');
    expect(json).toContain(`source persisted in workspace: ${source.length} chars`);
    expect(json).not.toContain('scenescenescene');
    expect(result.omitted).toContain('code_file_content_replaced_by_pointer');
  });
});

describe('agent tool history reconstruction', () => {
  it('reconstructs 200 complete chat rounds with tool evidence without truncation', () => {
    const visible = Array.from({ length: 200 }, (_, round) => {
      const base = round * 3;
      return [
        {
          id: `u-${round}`,
          role: 'user' as const,
          content: `request-${round}`,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, base)).toISOString(),
        },
        {
          id: `a-${round}`,
          role: 'assistant' as const,
          content: `result-${round}`,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, base + 2)).toISOString(),
        },
      ];
    }).flat();
    const tools = Array.from({ length: 200 }, (_, round) => ({
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, round * 3 + 1)).toISOString(),
      run_id: `run-${round}`,
      step: round,
      seq: 0,
      tool_call_id: `tool-${round}`,
      tool_name: 'read_file',
      input: { path: `code/round-${round}.js` },
      output: { type: 'text' as const, value: `evidence-${round}` },
    }));

    const startedAt = performance.now();
    const history = buildModelHistoryFromRows(visible, tools);
    const elapsedMs = performance.now() - startedAt;

    expect(history).toHaveLength(800);
    expect(JSON.stringify(history)).toContain('request-0');
    expect(JSON.stringify(history)).toContain('evidence-199');
    expect(JSON.stringify(history)).toContain('result-199');
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('keeps hundreds of visible turns instead of applying a fixed turn cap', () => {
    const visible = Array.from({ length: 601 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `turn-${index}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));

    const history = buildModelHistoryFromRows(visible, []);

    expect(history).toHaveLength(600);
    expect(history[0]).toMatchObject({ role: 'user', content: 'turn-0' });
    expect(history.at(-1)).toMatchObject({ role: 'assistant', content: 'turn-599' });
  });

  it('sanitizes legacy tool rows again before replaying them to the model', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '看截图', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '看完了。', created_at: '2026-06-01T00:00:02.000Z' },
    ], [{
      created_at: '2026-06-01T00:00:01.000Z',
      run_id: 'legacy-run',
      step: 0,
      seq: 0,
      tool_call_id: 'legacy-call',
      tool_name: 'custom_tool',
      input: { path: 'frame.png' },
      output: { type: 'json', value: { screenshotBytes: 'c'.repeat(8_192), assetId: 'asset-2' } },
    }]);

    const json = JSON.stringify(history);
    expect(json).not.toContain('c'.repeat(100));
    expect(json).toContain('asset-2');
    expect(json).toContain('omitted base64 payload');
  });

  it('rebuilds AI SDK model messages from visible messages and tool rows', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '好看点', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '我先读取 enhance 规则。', created_at: '2026-06-01T00:00:01.000Z' },
      { id: 'a2', role: 'assistant', content: 'editPrompt: ...', created_at: '2026-06-01T00:00:03.000Z' },
      { id: 'u2', role: 'user', content: '再自然一点', created_at: '2026-06-01T00:00:04.000Z' },
    ], [
      {
        created_at: '2026-06-01T00:00:02.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 0,
        tool_call_id: 'call-1',
        tool_name: 'read_file',
        input: { path: 'prompts/enhance.md' },
        output: { type: 'text', value: '[prompts/enhance.md]\n\nrules...' },
      },
    ]);

    expect(history.map(m => m.role)).toEqual(['user', 'assistant', 'assistant', 'tool', 'assistant']);
    expect(JSON.stringify(history)).toContain('"toolName":"read_file"');
    expect(JSON.stringify(history)).toContain('[prompts/enhance.md]');
    expect(JSON.stringify(history)).not.toContain('再自然一点');
  });

  it('groups same-step tool calls into AI SDK assistant/tool message pairs', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '读两个文件', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '读完了。', created_at: '2026-06-01T00:00:03.000Z' },
    ], [
      {
        created_at: '2026-06-01T00:00:01.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 0,
        tool_call_id: 'call-1',
        tool_name: 'read_file',
        input: { path: 'prompts/enhance.md' },
        output: { type: 'text', value: 'enhance rules' },
      },
      {
        created_at: '2026-06-01T00:00:02.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 1,
        tool_call_id: 'call-2',
        tool_name: 'read_file',
        input: { path: 'prompts/animate.md' },
        output: { type: 'text', value: 'animate rules' },
      },
    ]);

    expect(history.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect((history[1].content as Array<unknown>)).toHaveLength(2);
    expect((history[2].content as Array<unknown>)).toHaveLength(2);
  });

  it('does not replay UI-truncated run_code input back to the model', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '用 remotion 做视频', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '我先做结构。', created_at: '2026-06-01T00:00:03.000Z' },
    ], [
      {
        created_at: '2026-06-01T00:00:01.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 0,
        tool_call_id: 'call-1',
        tool_name: 'run_code',
        input: { runtime: 'browser', code: "const scenes = [...] ... (1329 chars)" },
        output: { type: 'json', value: { type: 'text', content: 'Error' } },
      },
      {
        created_at: '2026-06-01T00:00:02.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 1,
        tool_call_id: 'call-2',
        tool_name: 'read_file',
        input: { path: 'code/current.json' },
        output: { type: 'text', value: '[code/current.json]\n\n{}' },
      },
    ]);

    const json = JSON.stringify(history);
    expect(json).not.toContain('1329 chars');
    expect(json).not.toContain('"toolName":"run_code"');
    expect(json).toContain('"toolName":"read_file"');
  });

  it('still replays complete short run_code patches', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '把标题调大', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '改好了。', created_at: '2026-06-01T00:00:02.000Z' },
    ], [
      {
        created_at: '2026-06-01T00:00:01.000Z',
        run_id: 'run-1',
        step: 0,
        seq: 0,
        tool_call_id: 'call-1',
        tool_name: 'run_code',
        input: { runtime: 'browser', code: "return { type: 'patch', props: { title: '微信成长' } };" },
        output: { type: 'json', value: { type: 'text', content: 'Patch applied' } },
      },
    ]);

    const json = JSON.stringify(history);
    expect(json).toContain('"toolName":"run_code"');
    expect(json).toContain('微信成长');
  });

  it('replays run_code calls that execute a persisted code_path', () => {
    const history = buildModelHistoryFromRows([
      { id: 'u1', role: 'user', content: '执行刚才写好的代码', created_at: '2026-06-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '已经执行。', created_at: '2026-06-01T00:00:02.000Z' },
    ], [{
      created_at: '2026-06-01T00:00:01.000Z',
      run_id: 'run-1',
      step: 0,
      seq: 0,
      tool_call_id: 'call-code-path',
      tool_name: 'run_code',
      input: { runtime: 'composition', code_path: 'project-1/code/illustrated-timeline.js' },
      output: { type: 'json', value: { content: 'Draft saved' } },
    }]);

    const json = JSON.stringify(history);
    expect(json).toContain('"toolName":"run_code"');
    expect(json).toContain('project-1/code/illustrated-timeline.js');
  });
});
