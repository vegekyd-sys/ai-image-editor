import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAgent } from '@/lib/agentStream';

describe('Agent stream ownership', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not create a new model request just because a Studio workflow checkpoint exists', async () => {
    const event = {
      type: 'error' as const,
      message: 'interrupted',
      recoverable: true,
      checkpoint: {
        studioRunId: 'studio-run-123',
        studioRunStage: 'composition',
        studioRunStatePath: 'project/studio-runs/studio-run-123/run.json',
      },
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify(event)}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamAgent(
      { prompt: 'make a video', image: '', projectId: 'project-1' },
      { onDone, onError },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('interrupted');
  });

  it('releases durable chat when the model is done while video keeps rendering', async () => {
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
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('events=true');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('view=stream');
    expect(onVideoSnapshot).toHaveBeenCalledWith(
      'snapshot-1',
      'task-unified-1',
      expect.objectContaining({ status: 'processing' }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('aborts a durable run even when cancellation happens before the start response returns', async () => {
    let resolveStart!: (response: Response) => void;
    const startResponse = new Promise<Response>((resolve) => {
      resolveStart = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(startResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const onRunId = vi.fn();

    const stream = streamAgent(
      { prompt: 'start then stop', image: '', projectId: 'project-1', durable: true },
      { onRunId },
      controller.signal,
    );

    controller.abort();
    resolveStart(new Response(JSON.stringify({ runId: 'run-race' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await stream;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('signal');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/agent/abort');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      runId: 'run-race',
    });
    expect(onRunId).toHaveBeenNthCalledWith(1, 'run-race');
    expect(onRunId).toHaveBeenLastCalledWith(null);
  });
});
