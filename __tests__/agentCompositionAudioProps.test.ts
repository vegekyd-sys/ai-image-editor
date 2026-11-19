// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTools, type AgentContext } from '@/lib/agent-tools';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/workspace', () => ({
  readFile: vi.fn(async (path: string) => files.has(path) ? { content: files.get(path) } : null),
  writeFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
    return { success: true, storageUrl: 'https://workspace.test/draft.json' };
  }),
}));

const speechUrl = 'https://workspace.test/speech.wav';
const bedUrl = 'https://workspace.test/bed.wav';
const attachments = [{ audioUrl: speechUrl, trackIndex: 8 }, { audioUrl: bedUrl, trackIndex: 3 }];
const code = 'function Composition(props) { return <AbsoluteFill><Audio src={props.audio.src} /></AbsoluteFill>; }';

function makeTools() {
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [] }) };
  const ctx = {
    userId: 'owner', projectId: 'project', snapshotImages: [], currentSnapshotIndex: -1,
    supabase: { from: () => query }, audioAttachments: attachments,
  } as unknown as AgentContext;
  const tools = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as never);
  const execute = tools.run_code.execute!;
  return {
    ctx,
    async run(input: Parameters<typeof execute>[0]) {
      return await execute(input, { toolCallId: 'composition', messages: [], context: {} }) as { code_path?: string; content: string };
    },
  };
}

describe('composition audio props', () => {
  beforeEach(() => files.clear());

  it('saves URLs selected from the active Audio Index and preserves ordinary text', async () => {
    const { run } = makeTools();
    const saved = await run({
      runtime: 'composition',
      composition: {
        code, width: 320, height: 180, props: { audio: { src: '<<<audio_2>>>' }, label: 'Take <<<audio_1>>>' },
      },
    });
    expect(saved.code_path).toBeDefined();
    expect(JSON.parse(files.get(saved.code_path!)!).props).toEqual({
      audio: { src: bedUrl }, label: 'Take <<<audio_1>>>',
    });
  });

  it('resolves a new patch marker while preserving the existing bound track', async () => {
    const { ctx, run } = makeTools();
    await run({
      runtime: 'composition',
      composition: {
        code, width: 320, height: 180, props: { audio: { src: bedUrl }, unrelated: '<<<audio_4>>>' },
      },
    });
    ctx.audioAttachments = [attachments[1], attachments[0]];
    const saved = await run({
      runtime: 'composition',
      code: "return { type: 'patch', props: { replacement: ['<<<audio_2>>>'] } };",
    });
    expect(saved.code_path).toBeDefined();
    expect(JSON.parse(files.get(saved.code_path!)!).props).toEqual({
      audio: { src: bedUrl }, unrelated: '<<<audio_4>>>', replacement: [speechUrl],
    });
  });
});

describe('composition patch source selection', () => {
  const sourcePath = 'project/code/timeline.js';

  beforeEach(() => {
    files.clear();
    files.set(sourcePath, code);
  });

  it('rejects an inline patch mixed with an executable file without writing a new draft', async () => {
    const { run } = makeTools();
    const base = await run({ runtime: 'composition', code_path: sourcePath });
    const original = files.get(base.code_path!);
    const response = await run({
      runtime: 'composition',
      code_path: sourcePath,
      code: "return { type: 'patch', edits: [{ old: 'props.audio.src', new: 'props.bed.src' }] };",
    });
    expect(response.content).toContain('Remove the top-level code_path');
    expect(response.code_path).toBeUndefined();
    expect(files.get(base.code_path!)).toBe(original);
  });

  it('applies the inline patch when its result points to the saved draft JSON', async () => {
    const { run } = makeTools();
    const base = await run({ runtime: 'composition', code_path: sourcePath });
    const response = await run({
      runtime: 'composition',
      code: `return { type: 'patch', code_path: ${JSON.stringify(base.code_path)}, edits: [{ old: 'props.audio.src', new: 'props.bed.src' }] };`,
    });
    expect(response.content).toContain('Patched');
    expect(JSON.parse(files.get(response.code_path!)!).code).toContain('props.bed.src');
    expect(files.get(sourcePath)).toBe(code);
  });

  it('explains that a raw source file cannot be used as the saved draft JSON', async () => {
    const { run } = makeTools();
    const response = await run({
      runtime: 'composition',
      code: `return { type: 'patch', code_path: '${sourcePath}', props: { title: 'New title' } };`,
    });
    expect(response.content).toContain('saved composition JSON');
    expect(response.code_path).toBeUndefined();
  });
});
