import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('interactive Agent fast lane', () => {
  const editor = read('src/components/Editor.tsx');
  const route = read('src/app/api/agent/route.ts');
  const reconnect = read('src/hooks/useAgentRun.ts');
  const callbacks = read('src/lib/agentCallbacks.ts');
  const projectsPage = read('src/app/projects/page.tsx');
  const projectEditor = read('src/components/ProjectEditorContainer.tsx');

  it('streams interactive turns without booting the durable worker', () => {
    expect(editor).toContain('durable: false');
    expect(editor).toContain('hasTransientPixels ? { snapshotImages: snapshotImagesForApi } : {}');
    expect(editor).not.toContain('hasAllUrls');
    expect(route).toContain("transport: 'sse'");
    expect(route).toContain("reconnect: 'event-log'");
    expect(route).toContain('durable: false');
  });

  it('keeps reconnect logging out of the pre-model critical path', () => {
    expect(route).toContain('void writer.persistHeartbeat()');
    expect(route).not.toContain('await writer.persistHeartbeat();\n          firstMessageId');
    expect(route.indexOf('const timelineVersionPromise'))
      .toBeLessThan(route.indexOf('const activeRun = await activeRunPromise'));
  });

  it('replays immediately after disconnect and polls slowly while idle', () => {
    expect(callbacks).toContain("new CustomEvent('makaron-agent-disconnected'");
    expect(reconnect).toContain("window.addEventListener('makaron-agent-disconnected'");
    expect(reconnect).toContain("view: 'stream'");
    expect(reconnect).toContain('15_000');
  });

  it('pre-starts text-only project turns before navigation', () => {
    expect(projectsPage).toContain("sessionStorage.setItem(`pendingAgentRun:${result.projectId}`, runId)");
    expect(projectsPage).toContain('await agentResponse.body?.cancel()');
    expect(projectEditor).toContain('pendingAgentRunId={!readOnly');
    expect(editor).toContain('initialRunId: pendingAgentRunId');
    expect(editor).toContain("addMessage('user', pendingPrompt!)");
  });
});
