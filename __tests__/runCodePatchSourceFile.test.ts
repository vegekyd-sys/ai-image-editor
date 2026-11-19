// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTools, type AgentContext } from '@/lib/agent-tools';
import { resolveCompositionPatchBase } from '@/lib/composition-patch-base';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/workspace', () => ({
  readFile: vi.fn(async (path: string) => files.has(path) ? { content: files.get(path) } : null),
  writeFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
    return { success: true, storageUrl: `https://workspace.test/${path}` };
  }),
}));

const SOURCE_PATH = 'project/code/birthday-v2.js';
const source = [
  'function EndScene() {',
  '  const frame = useCurrentFrame();',
  '  return <AbsoluteFill style={{ opacity: 0.33, background: "#FFF7EC" }}><div>我们爱你</div></AbsoluteFill>;',
  '}',
  'function Composition(props) { return <AbsoluteFill><EndScene /></AbsoluteFill>; }',
].join('\n');

function makeTools() {
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [] }) };
  const ctx = {
    userId: 'owner', projectId: 'project', snapshotImages: [], currentSnapshotIndex: -1,
    supabase: { from: () => query },
  } as unknown as AgentContext;
  const tools = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as never);
  const execute = tools.run_code.execute!;
  return async (input: Parameters<typeof execute>[0]) =>
    await execute(input, { toolCallId: 'run', messages: [], context: {} }) as { code_path?: string; content: string };
}

const draftCode = (path?: string) => JSON.parse(files.get(path!)!).code as string;

describe('run_code patches a write_code_file source', () => {
  beforeEach(() => {
    files.clear();
    files.set(SOURCE_PATH, source);
  });

  it('runs the inline patch instead of silently re-rendering code_path, and updates the source file', async () => {
    const run = makeTools();
    const first = await run({ runtime: 'composition', code_path: SOURCE_PATH, composition: { width: 1080, height: 1920, props: { title: 'Hi' } } });
    expect(draftCode(first.code_path)).toContain('opacity: 0.33');

    const patched = await run({
      runtime: 'composition',
      code_path: SOURCE_PATH,
      code: `return { type: 'patch', code_path: '${SOURCE_PATH}', edits: [{ old: 'opacity: 0.33', new: 'opacity: 1' }] };`,
    });
    expect(patched.content).toContain('Patched');
    expect(draftCode(patched.code_path)).toContain('opacity: 1');
    expect(draftCode(patched.code_path)).not.toContain('opacity: 0.33');
    expect(JSON.parse(files.get(patched.code_path!)!)).toMatchObject({ width: 1080, height: 1920, props: { title: 'Hi' } });
    expect(files.get(SOURCE_PATH)).toContain('opacity: 1');

    // A later plain run of the file renders the patched source, not the old one.
    const rerun = await run({ runtime: 'composition', code_path: SOURCE_PATH });
    expect(draftCode(rerun.code_path)).toContain('opacity: 1');
  });

  it('uses the call-level code_path as the patch base when the patch result omits it', async () => {
    const run = makeTools();
    await run({ runtime: 'composition', code_path: SOURCE_PATH, composition: { width: 720, height: 1280 } });
    const patched = await run({
      runtime: 'composition',
      code_path: SOURCE_PATH,
      code: `return { type: 'patch', edits: [{ old: '我们爱你', new: '生日快乐' }] };`,
    });
    expect(patched.content).toContain(`from ${SOURCE_PATH}`);
    expect(draftCode(patched.code_path)).toContain('生日快乐');
  });

  it('still patches saved composition drafts', async () => {
    const run = makeTools();
    const first = await run({ runtime: 'composition', composition: { code: source, width: 1080, height: 1920 } });
    const patched = await run({
      runtime: 'composition',
      code: `return { type: 'patch', code_path: '${first.code_path}', edits: [{ old: 'opacity: 0.33', new: 'opacity: 0.8' }] };`,
    });
    expect(draftCode(patched.code_path)).toContain('opacity: 0.8');
    expect(files.get(SOURCE_PATH)).toContain('opacity: 0.33');
  });

  it('patches a script that returns a render result, re-runs it, and keeps the script in sync', async () => {
    const SCRIPT_PATH = 'project/code/birthday-card.js';
    files.set(SCRIPT_PATH, [
      'const code = String.raw`',
      'var CARD_END_OPACITY = 0.33;',
      'function Composition(props) { return <AbsoluteFill style={{ opacity: CARD_END_OPACITY }}><div>{props.title}</div></AbsoluteFill>; }',
      '`;',
      'return {',
      "  type: 'render',",
      '  code,',
      '  width: 1080,',
      '  height: 1920,',
      "  props: { title: '生日快乐', note: '岁岁平安' },",
      '  animation: { fps: 30, durationInSeconds: 6 },',
      '};',
    ].join('\n'));
    const run = makeTools();
    await run({ runtime: 'composition', code_path: SCRIPT_PATH });

    const patched = await run({
      runtime: 'composition',
      code_path: SCRIPT_PATH,
      code: `return { type: 'patch', code_path: '${SCRIPT_PATH}', edits: [
        { old: 'var CARD_END_OPACITY = 0.33;', new: 'var CARD_END_OPACITY = 1;' },
        { old: "title: '生日快乐',", new: "title: '妈妈生日快乐'," },
      ] };`,
    });
    expect(patched.content).toContain('Patched');
    const draft = JSON.parse(files.get(patched.code_path!)!);
    expect(draft.code).toContain('CARD_END_OPACITY = 1;');
    expect(draft.props).toEqual({ title: '妈妈生日快乐', note: '岁岁平安' });
    expect(draft).toMatchObject({ width: 1080, height: 1920, animation: { fps: 30, durationInSeconds: 6 } });
    expect(files.get(SCRIPT_PATH)).toContain("title: '妈妈生日快乐',");

    const rerun = await run({ runtime: 'composition', code_path: SCRIPT_PATH });
    expect(JSON.parse(files.get(rerun.code_path!)!).props.title).toBe('妈妈生日快乐');

    const broken = await run({
      runtime: 'composition',
      code: `return { type: 'patch', code_path: '${SCRIPT_PATH}', edits: [{ old: '\`;', new: '' }] };`,
    });
    expect(broken.content).toContain('no longer runs after the edits');
    expect(files.get(SCRIPT_PATH)).toContain('CARD_END_OPACITY = 1;');
  });

  it('explains why a non-composition file cannot be a patch base', () => {
    const base = resolveCompositionPatchBase('project/media-code/probe.js', 'const x = 1;\nreturn { type: "text", content: x };');
    expect(base).toHaveProperty('error');
    expect((base as { error: string }).error).toContain('is not a saved composition draft, a Remotion component source file, or a script');
  });
});
