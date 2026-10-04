// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeVideoWithProvider } from '@/lib/video-analysis';
import { getVideoAnalysisDefaultRate } from '@/lib/billing/video-analysis-rate';
import { mp4Fixture } from './helpers/mp4Fixture';

const files = vi.hoisted(() => ({ upload: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { files = files; } }));
const success = {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Private thinking', thought: true }, { text: 'A person films a street.' }] } }],
  usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 100, thoughtsTokenCount: 40, cachedContentTokenCount: 2000 },
};
function setup(mode = 'static') {
  vi.stubEnv('GOOGLE_API_KEY', 'test-private-key');
  vi.stubEnv('VIDEO_ANALYSIS_MODEL', '');
  vi.stubEnv('VIDEO_ANALYSIS_PROCESSING', mode);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('video analysis provider contract', () => {
  it('supplies real fractional duration to analysis instead of trusting summary timestamps', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(new Response(mp4Fixture()))
      .mockResolvedValueOnce(Response.json(success));
    const result = await analyzeVideoWithProvider('https://example.com/source.mp4');
    const prompt = JSON.parse(fetchMock.mock.calls[1][1].body).contents[0].parts[1].text;
    expect(prompt).toContain('Measured container duration: 5.184 seconds');
    expect(prompt).toContain('Compare opening and ending framing');
    expect(result.sourceDurationSeconds).toBe(5.184);
  });
  it('uses 3.8 low thinking and preserves cache/thought usage without exposing thinking text', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(Response.json(success));
    const result = await analyzeVideoWithProvider('https://example.com/source.webm', 'What happens at 4 seconds?');
    expect(fetchMock.mock.calls[1][0]).toContain('gemini-3.8-flash:generateContent');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe('video/webm');
    expect(result.analysis).toBe('A person films a street.');
    expect(result.usage).toMatchObject({ inputTokens: 5000, outputTokens: 140, cacheReadTokens: 2000, thoughtTokens: 40 });
    expect(result.usedModel).toBe('gemini-3.8-flash');
  });

  it.each([429, 500, 503])('does not re-download or re-submit a video for HTTP %s', async status => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'Provider unavailable' } }, { status }));
    await expect(analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing')).rejects.toThrow('Provider unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not turn configuration errors into inline retries', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'Invalid thinking level for model' } }, { status: 400 }));
    await expect(analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing')).rejects.toThrow('Invalid thinking');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads ordinary URLs once and submits inline without a failed URL inference', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(Response.json(success));
    const result = await analyzeVideoWithProvider('https://example.com/a.mp4');
    expect(result.transport).toBe('inline');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/a.mp4');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).contents[0].parts[0].inlineData.data).toBe('AQID');
  });

  it('uploads larger videos as Files and deletes only that temporary file', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(14_000_001)))
      .mockResolvedValueOnce(Response.json(success));
    files.upload.mockResolvedValue({ name: 'files/new-temporary', uri: 'https://google.test/file', state: 'ACTIVE' });
    files.delete.mockResolvedValue({});
    const result = await analyzeVideoWithProvider('https://example.com/a.mp4');
    expect(result.transport).toBe('file');
    const part = JSON.parse(fetchMock.mock.calls[1][1].body).contents[0].parts[0];
    expect(part.fileData.fileUri).toBe('https://google.test/file');
    expect(files.delete).toHaveBeenCalledWith({ name: 'files/new-temporary' });
  });

  it('rejects an oversized download before submitting inference', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-length': '38500001' } }));
    await expect(analyzeVideoWithProvider('https://example.com/a.mp4')).rejects.toThrow('38.5 MB');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('does not retry a provider permission failure after downloading the source', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(Response.json({ error: { message: 'The caller does not have permission' } }, { status: 403 }));
    await expect(analyzeVideoWithProvider('https://example.com/a.mp4')).rejects.toThrow('permission');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires actual agentic steps and accounts for tool input and thoughts exactly once', async () => {
    const fetchMock = setup('agentic');
    fetchMock.mockResolvedValue(Response.json({
      status: 'completed',
      steps: [{ type: 'processing_call' }, { type: 'processing_result' }, { type: 'model_output', content: [{ type: 'text', text: 'The sign appears at 4 seconds.' }] }],
      usage: { total_input_tokens: 116, total_tool_use_tokens: 4101, total_output_tokens: 971, total_thought_tokens: 949 },
    }));
    const result = await analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing');
    expect(result.usage).toMatchObject({ inputTokens: 4217, outputTokens: 1920 });
    expect(result.processingCalls).toBe(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input[0].processing).toBe('agentic');
    expect(body.generation_config.thinking_level).toBe('low');
    expect(body.store).toBe(false);
  });

  it('rejects a silent static response to an agentic request', async () => {
    const fetchMock = setup('agentic');
    fetchMock.mockResolvedValue(Response.json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Looks fine' }] }] }));
    await expect(analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing')).rejects.toThrow('not confirmed');
  });

  it('does not accept or retry a truncated answer', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(Response.json({ ...success, candidates: [{ ...success.candidates[0], finishReason: 'MAX_TOKENS' }] }));
    await expect(analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing')).rejects.toThrow('MAX_TOKENS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not disclose the key or signed source URLs in a tool error', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'Invalid test-private-key https://example.com/a.mp4?secret=private' } }, { status: 400 }));
    await expect(analyzeVideoWithProvider('https://generativelanguage.googleapis.com/v1beta/files/existing')).rejects.toThrow('Invalid [redacted] [media URL]');
  });
});

it('ends introductory 3.8 pricing at the published boundary', () => {
  expect(getVideoAnalysisDefaultRate(Date.parse('2026-12-31T23:59:59Z'))).toMatchObject({ input_per_1m: 0.75, output_per_1m: 3.75, cache_read_per_1m: 0.075 });
  expect(getVideoAnalysisDefaultRate(Date.parse('2027-01-01T00:00:00Z'))).toMatchObject({ input_per_1m: 1.5, output_per_1m: 7.5, cache_read_per_1m: 0.15 });
});
