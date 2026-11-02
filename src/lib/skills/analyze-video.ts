import { analyzeVideoContentWithUsage } from '../gemini';
import type { VideoAnalysisResult } from '../video-analysis';

export interface AnalyzeVideoInput {
  videoUrl: string;
  question?: string;
  userId?: string;
}

export interface AnalyzeVideoResult {
  success: boolean;
  message: string;
  analysis?: string;
  usedModel?: string;
  requestedModel?: string;
  reportedModel?: string;
  provider?: VideoAnalysisResult['provider'];
  fallbackReason?: string;
  creditsCharged?: number;
  subscriptionPaidCreditStatus?: VideoAnalysisResult['subscriptionPaidCreditStatus'];
  subscriptionConsumedCredits?: number | null;
  usage?: VideoAnalysisResult['usage'];
  processing?: VideoAnalysisResult['processing'];
  sourceDurationSeconds?: number;
}

export async function analyzeVideo(input: AnalyzeVideoInput): Promise<AnalyzeVideoResult> {
  const { videoUrl, question, userId } = input;

  if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
    return {
      success: false,
      message: 'Video analysis requires a publicly accessible video URL. Upload local files first.',
    };
  }

  try {
    const result = await analyzeVideoContentWithUsage(videoUrl, question, userId);
    return {
      success: true,
      message: `Video analysis completed. (model: ${result.usedModel}; processing: ${result.processing}; thinking: ${result.thinking})`,
      analysis: result.analysis,
      usedModel: result.usedModel,
      requestedModel: result.requestedModel,
      reportedModel: result.reportedModel,
      provider: result.provider,
      fallbackReason: result.fallbackReason,
      creditsCharged: result.creditsCharged,
      subscriptionPaidCreditStatus: result.subscriptionPaidCreditStatus,
      subscriptionConsumedCredits: result.subscriptionConsumedCredits,
      usage: result.usage,
      processing: result.processing,
      sourceDurationSeconds: result.sourceDurationSeconds,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: `Video analysis error: ${msg}`,
    };
  }
}
