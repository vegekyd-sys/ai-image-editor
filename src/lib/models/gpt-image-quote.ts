import type { ImageGenerationOptions } from './types';

/** Preflight estimate only. The final debit always uses the result's exact fal USD billable units. */
export function estimateGptImageCredits(options: ImageGenerationOptions & { imageResolution?: string; imageInputCount?: number }, markup: number): number {
  const quality = options.imageQuality ?? 'low';
  const base = quality === 'low' ? 0.03 : quality === 'medium' ? 0.05 : 0.07;
  const multiplier = options.outputFormat === 'gif' ? Math.min(options.frameCount ?? 9, 12) : options.imageResolution === '4K' ? 8 : options.imageResolution === '2K' ? 4 : 1;
  const estimatedUsd = base * multiplier + (options.outputFormat === 'svg' ? 0.05 : 0) + (options.imageInputCount ?? 0) * 0.015;
  if (!Number.isFinite(markup) || markup <= 0) throw new Error('Invalid GPT Image markup');
  return Math.ceil(estimatedUsd * markup / 0.01);
}
