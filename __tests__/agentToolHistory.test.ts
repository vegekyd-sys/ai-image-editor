import { describe, expect, it } from 'vitest';
import {
  buildModelHistoryFromRows,
  sanitizeToolHistory,
} from '../src/lib/agentToolHistory';

describe('agent tool history sanitizer', () => {
  it('keeps markdown read_file content but caps it', () => {
    const md = `${'a'.repeat(31_000)}data:image/png;base64,abcd`;
    const result = sanitizeToolHistory(
      'read_file',
      { path: 'prompts/enhance.md' },
      { path: 'prompts/enhance.md', type: 'text/markdown', content: md },
      { rows: 0, chars: 0 },
    );

    expect(result.output.type).toBe('text');
    expect(JSON.stringify(result.output)).toContain('[prompts/enhance.md]');
    expect(JSON.stringify(result.output)).not.toContain('data:image');
    expect(result.outputChars).toBeLessThanOrEqual(30_200);
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
      { workspaceUrl: 'https://example.com/frame.jpg', base64Data: 'data:image/jpeg;base64,' + 'a'.repeat(100_000) },
      { rows: 0, chars: 0 },
    );
    const image = sanitizeToolHistory(
      'generate_image',
      { editPrompt: 'make it cinematic', image: 'data:image/png;base64,' + 'b'.repeat(100_000), base64Data: 'd'.repeat(100_000) },
      { success: true, message: 'Image generated successfully.', image: 'data:image/png;base64,' + 'c'.repeat(100_000), base64Data: 'e'.repeat(100_000) },
      { rows: 0, chars: 0 },
    );

    expect(JSON.stringify(preview)).toContain('https://example.com/frame.jpg');
    expect(JSON.stringify(preview)).not.toContain('base64');
    expect(preview.omitted).toContain('removed_preview_frame_pixels');
    expect(JSON.stringify(image)).toContain('Image generated successfully.');
    expect(JSON.stringify(image)).not.toContain('data:image');
    expect(JSON.stringify(image)).not.toContain('base64Data');
    expect(image.omitted).toContain('removed_image');
    expect(image.omitted).toContain('removed_binary_payload');
  });

  it('enforces run budget with compact summary', () => {
    const result = sanitizeToolHistory(
      'read_file',
      { path: 'prompts/animate.md' },
      { path: 'prompts/animate.md', type: 'text/markdown', content: 'full prompt' },
      { rows: 20, chars: 10 },
    );

    expect(result.omitted).toContain('run_budget_exceeded');
    expect(JSON.stringify(result.output)).toContain('tool history run budget exceeded');
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
});

describe('agent tool history reconstruction', () => {
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
});
