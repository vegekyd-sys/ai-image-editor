import { GoogleGenAI } from '@google/genai';

/** Video understanding uses its own model and config; the shared SDK only uploads large fallback files. */
export const VIDEO_ANALYSIS_MODEL = 'gemini-3.8-flash';
export type VideoProcessing = 'static' | 'agentic';

export interface VideoAnalysisUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
}

export interface VideoAnalysisResult {
  analysis: string;
  usedModel: string;
  processing: VideoProcessing;
  thinking: 'low';
  elapsedMs: number;
  transport: 'url' | 'inline' | 'file';
  processingCalls: number;
  usage: VideoAnalysisUsage;
}

const API = 'https://generativelanguage.googleapis.com/v1beta';
const INLINE_LIMIT = 14_000_000; // base64 + envelope remains below 20 MB
const DOWNLOAD_LIMIT = 38_500_000; // preserve the existing fallback download ceiling

class VideoApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeVideoUsage(
  raw: Record<string, unknown>, modelId: string, processing: VideoProcessing,
): VideoAnalysisUsage {
  const interaction = processing === 'agentic';
  const thoughtTokens = count(raw[interaction ? 'total_thought_tokens' : 'thoughtsTokenCount']);
  const toolUseTokens = count(raw[interaction ? 'total_tool_use_tokens' : 'toolUsePromptTokenCount']);
  const inputTokens = count(raw[interaction ? 'total_input_tokens' : 'promptTokenCount']) + toolUseTokens;
  return {
    modelId, inputTokens, thoughtTokens, toolUseTokens,
    outputTokens: count(raw[interaction ? 'total_output_tokens' : 'candidatesTokenCount']) + thoughtTokens,
    cacheReadTokens: Math.min(inputTokens, count(raw[interaction ? 'total_cached_tokens' : 'cachedContentTokenCount'])),
  };
}

export async function analyzeVideoWithProvider(
  videoUrl: string, question?: string,
): Promise<VideoAnalysisResult> {
  const source = new URL(videoUrl);
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Video analysis requires an HTTP(S) URL.');
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not configured.');
  const model = process.env.VIDEO_ANALYSIS_MODEL?.trim() || VIDEO_ANALYSIS_MODEL;
  const configuredMode = process.env.VIDEO_ANALYSIS_PROCESSING || 'static';
  if (configuredMode !== 'static' && configuredMode !== 'agentic') throw new Error('Invalid VIDEO_ANALYSIS_PROCESSING.');
  const processing: VideoProcessing = configuredMode;
  const prompt = question || 'Describe this video in detail: scenes, actions, pacing, visual style, audio/dialogue if any.';
  const mimeType = /\.mov$/i.test(source.pathname) ? 'video/quicktime' : /\.webm$/i.test(source.pathname) ? 'video/webm' : 'video/mp4';
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(120_000); // includes URL attempt and bounded fallback

  async function run(data?: string, uploadedUri?: string) {
    const body = processing === 'agentic' ? {
      model, store: false,
      input: [
        { type: 'video', mime_type: mimeType, processing: 'agentic', ...(data ? { data } : { uri: uploadedUri || videoUrl }) },
        { type: 'text', text: prompt },
      ],
      generation_config: { thinking_level: 'low' },
    } : {
      contents: [{ role: 'user', parts: [
        data ? { inlineData: { mimeType, data } } : { fileData: { mimeType, fileUri: uploadedUri || videoUrl } },
        { text: prompt },
      ] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } },
    };
    const response = await fetch(processing === 'agentic' ? `${API}/interactions` : `${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key! },
      body: JSON.stringify(body), signal,
    });
    const result = await response.json();
    if (!response.ok) {
      // Do not leak signed media URLs or credentials through errors/tool history.
      const message = String(result.error?.message || `Google video analysis HTTP ${response.status}`)
        .replaceAll(key!, '[redacted]').replace(/https?:\/\/[^\s"<>]+/g, '[media URL]');
      throw new VideoApiError(response.status, message);
    }
    return result;
  }

  let transport: VideoAnalysisResult['transport'] = 'url';
  let result;
  try {
    result = await run();
  } catch (error) {
    // A rate limit, model/config error, safety block or outage is not a file failure.
    if (!(error instanceof VideoApiError) || ![400, 403, 404].includes(error.status)
      || !/(file uri|fileuri|fetch.*(file|video|url)|download|unsupported.*uri|permission.*file)/i.test(error.message)) throw error;
    const response = await fetch(videoUrl, { signal });
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
    if (Number(response.headers.get('content-length')) > DOWNLOAD_LIMIT) {
      await response.body?.cancel();
      throw new Error('Video URL was rejected and exceeds the 38.5 MB fallback limit. Use a provider-accessible URL or preview_frame.');
    }
    if (!response.body) throw new Error('Video download returned no body.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOWNLOAD_LIMIT) {
        await reader.cancel();
        throw new Error('Video exceeds the 38.5 MB fallback limit. Use a provider-accessible URL or preview_frame.');
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (size <= INLINE_LIMIT) {
      transport = 'inline';
      result = await run(bytes.toString('base64'));
    } else {
      transport = 'file';
      const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 30_000 } });
      signal.throwIfAborted();
      let file = await ai.files.upload({ file: new Blob([bytes], { type: mimeType }), config: { mimeType } });
      const name = file.name;
      if (!name) throw new Error('Google file upload returned no file name.');
      try {
        while (file.state === 'PROCESSING') {
          signal.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, 1000));
          file = await ai.files.get({ name });
        }
        signal.throwIfAborted();
        if (file.state !== 'ACTIVE' || !file.uri) throw new Error('Google video file did not become active.');
        result = await run(undefined, file.uri);
      } finally {
        await ai.files.delete({ name }).catch(() => console.warn('[video-analysis] temporary Google file cleanup failed'));
      }
    }
  }

  const candidate = result.candidates?.[0];
  const steps = result.steps || [];
  const processingCalls = steps.filter((step: { type: string }) => step.type === 'processing_call').length;
  let analysis: string;
  if (processing === 'agentic') {
    if (result.status !== 'completed') throw new Error(`Video analysis did not complete (${result.status || 'unknown'}).`);
    if (!processingCalls || !steps.some((step: { type: string }) => step.type === 'processing_result')) {
      throw new Error('Agentic video processing was not confirmed by the provider.');
    }
    analysis = steps.filter((step: { type: string }) => step.type === 'model_output')
      .flatMap((step: { content?: { type: string; text?: string }[] }) => step.content || [])
      .filter((part: { type: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text || '').join('\n');
  } else {
    if (candidate?.finishReason !== 'STOP') throw new Error(`Video analysis did not complete (${candidate?.finishReason || result.promptFeedback?.blockReason || 'no candidate'}).`);
    analysis = (candidate.content?.parts || []).filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text).join('\n');
  }
  if (!analysis.trim()) throw new Error('Video analysis returned no text.');
  const rawUsage = processing === 'agentic' ? result.usage : result.usageMetadata;
  if (!rawUsage) throw new Error('Video analysis returned no usage metadata.');
  const usage = normalizeVideoUsage(rawUsage, model, processing);
  const elapsedMs = Date.now() - startedAt;
  console.info(`[video-analysis] model=${model} processing=${processing} thinking=low transport=${transport} durationMs=${elapsedMs} input=${usage.inputTokens} output=${usage.outputTokens} cache=${usage.cacheReadTokens} processingCalls=${processingCalls}`);
  return { analysis, usedModel: model, processing, thinking: 'low', elapsedMs, transport, processingCalls, usage };
}
