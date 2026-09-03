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
  usage?: VideoAnalysisResult['usage'];
  processing?: VideoAnalysisResult['processing'];
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
      usage: result.usage,
      processing: result.processing,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: `Video analysis error: ${msg}`,
    };
  }
}
