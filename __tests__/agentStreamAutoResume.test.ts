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
    expect(prompt).toContain('under 9000 source characters');
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
});
