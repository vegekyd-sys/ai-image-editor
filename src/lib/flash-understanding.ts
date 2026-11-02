import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { analyzeVideoWithProvider, normalizeVideoUsage, VIDEO_ANALYSIS_MODEL, type VideoAnalysisResult } from './video-analysis';
import { tryGeminiUnderstandingSubscription, type UnderstandingImage, type UnderstandingOperation } from './gemini-video-subscription';

/** All old Flash vision helpers use the same route and complete token accounting. */
export async function generateFlashUnderstanding(input: {
  operation: UnderstandingOperation; images: UnderstandingImage[]; question: string;
  userId?: string; videoUrl?: string;
}): Promise<string> {
  let result = await tryGeminiUnderstandingSubscription(input);
  if (!result) {
    if (input.videoUrl) {
      result = await analyzeVideoWithProvider(input.videoUrl, input.question, { images: input.images, processing: 'static' });
    } else {
      const started = Date.now();
      const ai = new GoogleGenAI({ apiKey: process.env.VIDEO_ANALYSIS_GOOGLE_API_KEY?.trim() || process.env.GOOGLE_API_KEY,
        httpOptions: { timeout: 120000 } });
      const response = await ai.models.generateContent({
        model: VIDEO_ANALYSIS_MODEL,
        contents: [{ role: 'user', parts: [...input.images.map(inlineData => ({ inlineData })), { text: input.question }] }],
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      if (response.candidates?.length !== 1 || response.candidates[0].finishReason !== 'STOP' || !response.text?.trim() || !response.usageMetadata) {
        throw new Error('Image understanding did not return a complete result.');
      }
      result = { analysis: response.text, usedModel: response.modelVersion || VIDEO_ANALYSIS_MODEL,
        requestedModel: VIDEO_ANALYSIS_MODEL, reportedModel: response.modelVersion, provider: 'google-api', billing: 'api',
        processing: 'static', thinking: 'low', transport: 'inline', processingCalls: 0, elapsedMs: Date.now()-started,
        usage: normalizeVideoUsage(response.usageMetadata as Record<string, unknown>, VIDEO_ANALYSIS_MODEL, 'static') } as VideoAnalysisResult;
    }
  }
  if (input.userId) {
    const { deductByTokens, recordSubscriptionUsage } = await import('./billing/credits');
    const action = input.operation === 'makaron_image_analysis' ? 'analyze_image' : 'analyze_video';
    const u = result.usage;
    // Await the single ledger write: serverless shutdown must not lose billing.
    if (result.provider === 'gemini-subscription') {
      await recordSubscriptionUsage(input.userId, 'gemini-subscription', action, result.usedModel, {
        inputTokens: u.inputTokens, outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens, durationMs: result.elapsedMs,
      }).catch(() => console.error('[billing] Google subscription usage logging failed'));
    } else {
      await deductByTokens(input.userId, action, u.modelId, u.inputTokens-u.cacheReadTokens, u.outputTokens,
        result.elapsedMs, undefined, { cacheRead: u.cacheReadTokens, cacheWrite: 0 })
        .catch(() => console.error('[billing] Google understanding billing failed'));
    }
  }
  console.info('[flash-understanding-route]', JSON.stringify({ operation: input.operation,
    provider: result.provider, requestedModel: result.requestedModel, actualModel: result.reportedModel ?? null,
    elapsedMs: result.elapsedMs, ...result.usage }));
  return result.analysis;
}
