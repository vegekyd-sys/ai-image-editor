import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { formatAspectRatio } from '@/lib/media-aspect';
import { validateDesign } from '@/lib/design-harness';
import { normalizeCompositionAnimation } from '@/lib/composition-duration';
import { resolveMediaMarkersInString, resolveMediaMarkersInValue } from '@/lib/media-markers';

// Run the actual tool factory and guard, isolating database writes and unrelated
// provider SDKs. This exercises schema -> execution -> validation -> autosave.
const source = readFileSync('src/lib/agent-tools.ts', 'utf8');
const parsed = ts.createSourceFile('agent-tools.ts', source, ts.ScriptTarget.Latest, true);
const names = ['createRunCodeTool', 'validateCompositionMediaAspect'];
const functions = names.map(name => {
  const node = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node.getText(parsed);
}).join('\n');
const executable = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(dimensions = [[1280, 720], [1280, 720]]) {
  const rows = dimensions.map(([width, height], i) => ({
    id: String(i), video_meta: { videoUrl: `https://media.test/${i}.mp4`, width, height },
  }));
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows }).then(resolve) };
  const persist = vi.fn(async () => ({ success: true, path: 'test/drafts/current.json' }));
  const ctx = { projectId: 'test', userId: 'test', supabase: { from: vi.fn(() => query) },
    snapshotImages: rows.map(r => r.video_meta.videoUrl), generatedImages: [] };
  const scope = vm.createContext({ z, Buffer, console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tool: (value: unknown) => value, ctx, formatAspectRatio, validateDesign,
    normalizeCompositionAnimation, resolveMediaMarkersInString, resolveMediaMarkersInValue,
    refreshSnapshotUrls: vi.fn(), getStudioRunCheckpoint: async () => null,
    studioCompositionPromiseError: () => null, persistCompositionDraft: persist,
  });
  vm.runInContext(executable, scope);
  const tool = vm.runInContext('createRunCodeTool({ctx})', scope);
  const payload = (width: number, height: number, target?: string) => ({
    runtime: 'composition', target_aspect_ratio: target,
    composition: { width, height, code: 'function Composition(props) { return <AbsoluteFill><Video src={props.clip} style={{width:"100%",height:"100%",objectFit:"contain"}} muted /></AbsoluteFill>; }',
      props: { clip: rows[0].video_meta.videoUrl, sources: rows.map(row => row.video_meta.videoUrl) }, animation: { fps: 30, durationInSeconds: 3 } },
  });
  return { tool, payload, persist };
}

describe('requested composition canvas', () => {
  it('reproduces AFF rejection without a target, then autosaves the same 9:16 draft with an explicit target', async () => {
    const { tool, payload, persist } = harness();
    const rejected = await tool.execute(tool.inputSchema.parse(payload(1080, 1920)));
    expect(rejected.content).toContain('Composition rejected: selected timeline video');
    expect(rejected.content).toContain('target_aspect_ratio');
    expect(persist).not.toHaveBeenCalled();
    const accepted = await tool.execute(tool.inputSchema.parse(payload(1080, 1920, '9:16')));
    expect(accepted.content).toContain('Composition ready');
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ design: expect.objectContaining({ width: 1080, height: 1920 }) }));
  });
  it.each([[1920,1080,'16:9'],[1080,1080,'1:1'],[1080,1350,'4:5']])('accepts requested %sx%s %s from vertical footage', async (w,h,target) => {
    const {tool,payload}=harness([[720,1280]]);
    expect((await tool.execute(tool.inputSchema.parse(payload(Number(w),Number(h),String(target))))).content).toContain('Composition ready');
  });
  it('rejects the wrong output even when it matches the source, and keeps recovery in Remotion', async () => {
    const {tool,payload,persist}=harness();
    const result=await tool.execute(tool.inputSchema.parse(payload(1920,1080,'9:16')));
    expect(result.content).toContain('does not match the requested');
    expect(result.content).toContain('do not switch to Node/FFmpeg');
    expect(persist).not.toHaveBeenCalled();
  });
  it('preserves the default for vertical footage and allows an unchanged vertical canvas', async () => {
    const {tool,payload}=harness([[720,1280]]);
    expect((await tool.execute(tool.inputSchema.parse(payload(1920,1080)))).content).toContain('Composition rejected');
    expect((await tool.execute(tool.inputSchema.parse(payload(1080,1920)))).content).toContain('Composition ready');
  });
  it('retains mixed-source flexibility without an explicit target', async () => {
    const {tool,payload}=harness([[1280,720],[720,1280]]);
    expect((await tool.execute(tool.inputSchema.parse(payload(1080,1080)))).content).toContain('Composition ready');
  });
  it.each(['0:16','9:0','-9:16','9:16junk','Infinity:1'])('rejects invalid target %s in the tool schema', target => {
    const {tool,payload}=harness();
    expect(tool.inputSchema.safeParse(payload(1080,1920,target)).success).toBe(false);
  });
});
