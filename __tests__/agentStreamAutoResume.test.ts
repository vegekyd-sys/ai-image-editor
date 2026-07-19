import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STUDIO_RUN_AUTO_RESUMES,
  buildStudioRunAutoResumePrompt,
  shouldAutoResumeStudioRun,
  streamAgent,
} from '@/lib/agentStream';

const event = {
  type: 'error' as const,
  message: 'interrupted',
  recoverable: true,
  checkpoint: {
    studioRunId: 'studio-run-123',
    studioRunStage: 'composition',
    studioRunStatePath: 'project/studio-runs/studio-run-123/run.json',
    streamedCodePath: 'project/drafts/streamed-run-code.partial.js',
    streamedCodeChars: 8000,
  },
};

describe('Studio Run automatic stream recovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('automatically resumes a durable Studio Run checkpoint within the retry limit', () => {
    expect(shouldAutoResumeStudioRun(event, 0)).toBe(true);
    expect(shouldAutoResumeStudioRun(event, MAX_STUDIO_RUN_AUTO_RESUMES)).toBe(false);
  });

  it('does not automatically retry ordinary agent errors without a Studio Run checkpoint', () => {
    expect(shouldAutoResumeStudioRun({ ...event, checkpoint: {} }, 0)).toBe(false);
    expect(shouldAutoResumeStudioRun({ ...event, recoverable: false }, 0)).toBe(false);
  });

  it('tells the next request to reuse persisted stages and skip reference rereads', () => {
    const prompt = buildStudioRunAutoResumePrompt(event);
    expect(prompt).toContain('studio-run-123');
    expect(prompt).toContain('composition');
    expect(prompt).toContain('Call studio_run status first');
    expect(prompt).toContain('Reuse all persisted stage artifacts');
    expect(prompt).toContain('Do not reread skill, prompt, director, component-library, or reference files');
    expect(prompt).toContain('streamed-run-code.partial.js');
    expect(prompt).toContain('composition-parts');
    expect(prompt).toContain('compositionWorkspace.status="ready"');
    expect(prompt).toContain('use its designPath directly');
    expect(prompt).toContain('do not restart a monolithic run_code payload');
    expect(prompt).not.toContain('under 9000 source characters');
  });

  it('starts a fresh request automatically and only completes once', async () => {
    const sse = (payload: object) => new Response(`data: ${JSON.stringify(payload)}\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sse(event))
      .mockResolvedValueOnce(sse({ type: 'done' }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAgent(
      { prompt: 'make a video', image: '', projectId: 'project-1' },
      { onDone, onError },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      projectId: 'project-1',
      prompt: expect.stringContaining('studio-run-123'),
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('releases durable chat when the agent is done while video keeps rendering', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'in_progress',
        agent_status: 'completed',
        events: [{
          seq: 1,
          type: 'video_snapshot',
          data: {
            snapshotId: 'snapshot-1',
            taskId: 'task-unified-1',
            videoMeta: { status: 'processing', taskId: 'task-unified-1' },
          },
        }],
        next_poll_after_ms: 10_000,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const onVideoSnapshot = vi.fn();

    await streamAgent(
      { prompt: 'render with Seedance', image: '', projectId: 'project-1', durable: true },
      { onDone, onVideoSnapshot },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onVideoSnapshot).toHaveBeenCalledWith(
      'snapshot-1',
      'task-unified-1',
      expect.objectContaining({ status: 'processing' }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
