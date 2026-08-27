import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  wrapDurableIdempotentTools,
  wrapDurableInputAwareTools,
} from '@/lib/agent-tool-guards';

const root = process.cwd();

function readAgentSources(): string {
  return [
    'src/lib/agent.ts',
    'src/lib/agent-tools.ts',
    'src/lib/agent-tool-guards.ts',
  ]
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
}

function extractSet(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name} = new Set([`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(']);', start);
  expect(end, `${name} must close`).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe('Agent tool registry contract', () => {
  it('keeps the complete public tool surface stable during extraction', () => {
    const source = readAgentSources();
    const names = [...source.matchAll(/^\s{4}([a-z_]+): create[A-Za-z]+Tool\(scope\),$/gm)]
      .map((match) => match[1]);

    expect(names).toEqual([
      'generate_image',
      'generate_animation',
      'analyze_image',
      'analyze_video',
      'transcribe_audio',
      'prepare_visual_asset',
      'execution_checkpoint',
      'studio_run',
      'publish_draft',
      'materialize_media',
      'preview_frame',
      'rotate_camera',
      'list_files',
      'read_file',
      'write_code_file',
      'write_file',
      'delete_file',
      'run_code',
      'generate_audio',
    ]);
  });

  it('keeps durable side-effect guards attached to the same tools', () => {
    const source = readAgentSources();

    expect(extractSet(source, 'DURABLE_IDEMPOTENT_TOOLS')).toEqual([
      'generate_image',
      'generate_animation',
      'materialize_media',
      'rotate_camera',
      'generate_audio',
      'prepare_visual_asset',
    ]);

    const guardedSource = source.slice(source.indexOf('const DURABLE_INPUT_GUARDED_TOOLS'));
    expect(guardedSource).toContain('...DURABLE_IDEMPOTENT_TOOLS');
    expect(extractSet(source, 'DURABLE_INPUT_GUARDED_TOOLS')).toEqual([
      'studio_run',
      'publish_draft',
      'write_file',
      'write_code_file',
      'run_code',
      'preview_frame',
      'delete_file',
      'execution_checkpoint',
    ]);
  });

  it('preserves the agent facade contract', () => {
    const facade = fs.readFileSync(path.join(root, 'src/lib/agent.ts'), 'utf8');
    expect(facade).toContain('export interface RunMakaronAgentOptions');
    expect(facade).toContain('export async function* runMakaronAgent(');
    expect(facade).toMatch(/export (?:type AgentStreamEvent|type \{[^}]*AgentStreamEvent)/s);
  });

  it('blocks a durable mutation when a newer Agent Run input exists', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { status: 'running', input_version: 3 },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const ctx = {
      execution: { runId: 'run-1', attemptId: 'attempt-1', inputEpoch: 2 },
      supabase: { from: vi.fn(() => query) },
      userId: 'user-1',
    } as any;
    const tools = wrapDurableInputAwareTools({ write_file: { execute } }, ctx);

    await expect(tools.write_file.execute({ path: 'draft.txt' })).resolves.toMatchObject({
      success: false,
      terminal: true,
      errorCode: 'agent_input_received',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reuses a completed idempotent operation without repeating its side effect', async () => {
    const execute = vi.fn(async () => ({ success: true, taskId: 'new-task' }));
    const supabase = {
      rpc: vi.fn(async () => ({
        data: [{
          claimed: false,
          operation_status: 'completed',
          operation_result: { success: true, taskId: 'existing-task' },
        }],
        error: null,
      })),
    };
    const ctx = {
      execution: { runId: 'run-1', attemptId: 'attempt-1', inputEpoch: 2 },
      supabase,
      userId: 'user-1',
    } as any;
    const tools = wrapDurableIdempotentTools({ generate_animation: { execute } }, ctx);

    await expect(tools.generate_animation.execute({ prompt: 'launch film' })).resolves.toMatchObject({
      success: true,
      taskId: 'existing-task',
      reused: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
