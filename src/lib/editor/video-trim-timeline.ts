interface DeriveSequenceStartFrameInput {
  compositionFrame: number;
  sourceTimeSeconds: number;
  trimStartFrame: number;
  fps: number;
}

interface SourceToCompositionFrameInput {
  sourceFrame: number;
  trimStartFrame: number;
  sequenceStartFrame: number;
}

interface CompositionToSourceFrameInput {
  compositionFrame: number;
  trimStartFrame: number;
  sequenceStartFrame: number;
}

function finiteFrame(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function getSourceDurationInFrames(
  sourceDurationSeconds: number | undefined,
  fps: number,
  existingEndFrame: number,
): number {
  const durationFrames = sourceDurationSeconds && Number.isFinite(sourceDurationSeconds)
    ? Math.round(sourceDurationSeconds * fps)
    : 0;
  return Math.max(1, finiteFrame(existingEndFrame), durationFrames);
}

export function deriveSequenceStartFrame({
  compositionFrame,
  sourceTimeSeconds,
  trimStartFrame,
  fps,
}: DeriveSequenceStartFrameInput): number {
  const sourceFrame = finiteFrame(sourceTimeSeconds * fps);
  return finiteFrame(compositionFrame) - (sourceFrame - finiteFrame(trimStartFrame));
}

export function sourceFrameToCompositionFrame({
  sourceFrame,
  trimStartFrame,
  sequenceStartFrame,
}: SourceToCompositionFrameInput): number {
  return finiteFrame(sequenceStartFrame) + (finiteFrame(sourceFrame) - finiteFrame(trimStartFrame));
}

export function compositionFrameToSourceFrame({
  compositionFrame,
  trimStartFrame,
  sequenceStartFrame,
}: CompositionToSourceFrameInput): number {
  return finiteFrame(trimStartFrame) + (finiteFrame(compositionFrame) - finiteFrame(sequenceStartFrame));
}
