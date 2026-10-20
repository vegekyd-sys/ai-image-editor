import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Agent first-token safe prefetch contract', () => {
  const agent = read('src/lib/agent.ts');
  const runner = read('src/lib/agent-execution-runner.ts');
  const route = read('src/app/api/agent/route.ts');

  it('keeps project-specific system-prompt content in the final project block', () => {
    const workspaceStart = agent.indexOf('const workspaceSection = `');
    const projectStart = agent.indexOf('const projectSection = [', workspaceStart);
    const assembly = agent.indexOf(
      'const full = base + workspaceSection + userMemorySection + projectSection;',
      projectStart,
    );

    expect(workspaceStart).toBeGreaterThan(-1);
    expect(projectStart).toBeGreaterThan(workspaceStart);
    expect(assembly).toBeGreaterThan(projectStart);
    expect(agent.slice(workspaceStart, projectStart)).not.toContain('${projectId}');
    expect(agent.slice(projectStart, assembly)).toContain('## Current project');
    expect(agent.slice(projectStart, assembly)).toContain('${projectId}/code/');
    expect(agent).toContain('cacheablePrefix=${cacheablePrefixLen}');
  });

  it('starts manifest and memory reads together', () => {
    const readsStart = agent.indexOf('const [manifest, userMemory, projectMemory] = await Promise.all([');
    const readsEnd = agent.indexOf(']);', readsStart);
    const reads = agent.slice(readsStart, readsEnd);

    expect(readsStart).toBeGreaterThan(-1);
    expect(reads).toContain('workspace.getSkillManifest(supabase, userId)');
    expect(reads).toContain("readMemory('memory/MEMORY.md')");
    expect(reads).toContain('readMemory(`projects/${projectId}/memory/MEMORY.md`)');
  });

  it('prefetches prompt reads before context and preserves inline fallback', () => {
    expect(agent).toContain('export function prefetchAgentPrompt');
    expect(agent).toContain('corePromptMode.catch(() => {})');
    expect(agent).toContain('systemPrompt.catch(() => {})');
    expect(agent).toContain('prefetch.corePromptMode.catch(() => null)');
    expect(agent).toContain('prefetch.systemPrompt.catch(() => null)');
    expect(agent).toContain('prefetchedSystemPrompt ?? await buildSystemPrompt');

    const prefetchStart = runner.indexOf(
      'const promptPrefetch = prefetchAgentPrompt(admin, run.user_id, run.project_id);',
    );
    const contextStart = runner.indexOf('const ctx = await buildPromptContext(', prefetchStart);
    const agentStart = runner.indexOf('for await (const event of runMakaronAgent(', contextStart);

    expect(prefetchStart).toBeGreaterThan(-1);
    expect(contextStart).toBeGreaterThan(prefetchStart);
    expect(agentStart).toBeGreaterThan(contextStart);
    expect(runner.slice(agentStart, agentStart + 3_000)).toContain('promptPrefetch,');
  });

  it('runs read-only route gates early while keeping rejection before billing writes', () => {
    const structuralValidation = route.indexOf("JSON.stringify({ error: 'projectId and (image or prompt) are required' })");
    const readOnlyStart = route.indexOf('const projectPromise =');
    const gateAwait = route.indexOf('await Promise.all([', readOnlyStart);
    const conflict = route.indexOf("if (admission?.kind === 'conflict')", gateAwait);
    const credit = route.indexOf('const creditCheck = await requireCredits(userId, 5);', conflict);
    const appendWrites = route.indexOf('if (isNormalMode && admission)', credit);
    const runInsert = route.indexOf("supabase.from('agent_runs').insert", appendWrites);

    expect(structuralValidation).toBeGreaterThan(-1);
    expect(structuralValidation).toBeLessThan(credit);
    expect(readOnlyStart).toBeLessThan(gateAwait);
    expect(route.slice(readOnlyStart, gateAwait)).toContain('codexSubscriptionAllowedPromise');
    expect(route.slice(readOnlyStart, gateAwait)).toContain('skillLaunchContextPromise');
    expect(route.slice(readOnlyStart, gateAwait)).toContain('activeRunPromise');
    expect(conflict).toBeLessThan(credit);
    expect(credit).toBeLessThan(appendWrites);
    expect(credit).toBeLessThan(runInsert);
  });

  it('retains the full tool surface and durable inline SSE contracts', () => {
    expect(agent).toContain('createTools(ctx, runtime');
    expect(route).toContain("transport: 'sse'");
    expect(route).toContain("reconnect: 'event-log'");
    expect(route).toContain("mode: 'inline-first-attempt'");
    expect(route).toContain('runAgentExecutionAttempt(runId');
    expect(runner).toContain('execution: {');
  });
});
