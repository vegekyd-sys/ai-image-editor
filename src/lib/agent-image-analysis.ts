export interface ImageAnalysisRuntimeSpec {
  supportsImageInput: boolean;
  provider: string;
}

/** Resolve whether analyze_image stays in the selected Agent or needs a vision fallback. */
export function resolveAnalyzeImageProvider(
  runtime: { spec: ImageAnalysisRuntimeSpec },
): string {
  return runtime.spec.supportsImageInput ? runtime.spec.provider : 'gemini-api';
}
