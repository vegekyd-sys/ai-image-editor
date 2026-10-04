import { extractUserReferencedMediaIndices } from './media-markers';

export function resolveExplicitTurnMediaIndices(input: {
  totalMediaCount: number;
  userMessage: string;
  turnMediaCount?: number;
  referenceImageCount?: number;
  uploadedVideoCount?: number;
}): number[] {
  const total = Math.max(0, Math.floor(input.totalMediaCount));
  const declaredTurnCount = Math.max(0, Math.floor(input.turnMediaCount || 0));
  const inferredTurnCount = Math.max(0, Math.floor(input.referenceImageCount || 0))
    + Math.max(0, Math.floor(input.uploadedVideoCount || 0));
  const turnCount = Math.min(total, declaredTurnCount || inferredTurnCount);
  const indices = new Set(
    extractUserReferencedMediaIndices(input.userMessage)
      .filter(index => index <= total),
  );

  for (let index = total - turnCount + 1; index <= total; index += 1) {
    if (index > 0) indices.add(index);
  }

  return [...indices].sort((a, b) => a - b);
}
