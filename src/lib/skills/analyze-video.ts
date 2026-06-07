import { analyzeVideoContent } from '../gemini';

export interface AnalyzeVideoInput {
  videoUrl: string;
  question?: string;
  userId?: string;
}

export interface AnalyzeVideoResult {
  success: boolean;
  message: string;
  analysis?: string;
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
    const analysis = await analyzeVideoContent(videoUrl, question, userId);
    return {
      success: true,
      message: 'Video analysis completed.',
      analysis,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: `Video analysis error: ${msg}`,
    };
  }
}
