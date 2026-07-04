function evaluateCompositionNumber(
  expression: string | undefined,
  constants: Map<string, string>,
  seen = new Set<string>(),
): number | null {
  const raw = expression?.trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

  const direct = raw.match(/^[A-Za-z_$][\w$]*$/)?.[0];
  if (direct) {
    if (seen.has(direct)) return null;
    const value = constants.get(direct);
    if (!value) return null;
    return evaluateCompositionNumber(value, constants, new Set([...seen, direct]));
  }

  const sanitized = raw.replace(/\bMath\.(round|floor|ceil)\b/g, '__$1');
  if (!/^[\d\s+\-*/().,A-Za-z_$]+$/.test(sanitized)) return null;

  const identifiers = Array.from(new Set(sanitized.match(/\b[A-Za-z_$][\w$]*\b/g) || []))
    .filter(id => !['__round', '__floor', '__ceil'].includes(id));
  const values: Record<string, number> = {};
  for (const id of identifiers) {
    const value = evaluateCompositionNumber(id, constants, new Set(seen));
    if (value === null) return null;
    values[id] = value;
  }

  try {
    const fn = new Function(
      ...identifiers,
      '__round',
      '__floor',
      '__ceil',
      `"use strict"; return (${sanitized});`,
    ) as (...args: unknown[]) => number;
    const result = fn(
      ...identifiers.map(id => values[id]),
      Math.round,
      Math.floor,
      Math.ceil,
    );
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function collectCompositionNumericConstants(code: string): Map<string, string> {
  const constants = new Map<string, string>();
  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  for (const match of code.matchAll(declarationPattern)) {
    constants.set(match[1], match[2].trim());
  }
  return constants;
}

function readJsxNumericAttr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}=\\{([^}]+)\\}`))?.[1]
    || attrs.match(new RegExp(`\\b${name}=["'](\\d+(?:\\.\\d+)?)["']`))?.[1]
    || attrs.match(new RegExp(`\\b${name}=(\\d+(?:\\.\\d+)?)`))?.[1];
}

export function inferCompositionTotalFrames(code: string): number | null {
  const constants = collectCompositionNumericConstants(code);
  let maxFrame = 0;
  let found = false;
  const sequencePattern = /<Sequence\b([^>]*)>/g;
  for (const match of code.matchAll(sequencePattern)) {
    const attrs = match[1] || '';
    const from = evaluateCompositionNumber(readJsxNumericAttr(attrs, 'from') || '0', constants) ?? 0;
    const duration = evaluateCompositionNumber(readJsxNumericAttr(attrs, 'durationInFrames'), constants) ?? 0;
    if (!Number.isFinite(from) || !Number.isFinite(duration) || duration <= 0) continue;
    found = true;
    maxFrame = Math.max(maxFrame, from + duration);
  }

  const totalFrameConstants = Array.from(constants.entries())
    .filter(([name]) => /^(totalF|totalFrames|totalDurationFrames|durationFrames|durationInFrames)$/i.test(name))
    .map(([, value]) => evaluateCompositionNumber(value, constants))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  const totalFrames = Math.max(found ? maxFrame : 0, ...totalFrameConstants);
  return totalFrames > 0 ? totalFrames : null;
}

export function normalizeCompositionAnimation(
  code: string,
  animation: { fps?: number; durationInSeconds?: number; durationInFrames?: number; format?: string } | undefined,
): { fps: number; durationInSeconds: number; format?: string } | undefined {
  if (!animation) return undefined;
  const { durationInFrames: _durationInFrames, ...animationOutput } = animation;
  const fps = Number(animation.fps) || 30;
  const explicitFrames = Number(animation.durationInFrames);
  const inferredFrames = Number.isFinite(explicitFrames) && explicitFrames > 0
    ? explicitFrames
    : inferCompositionTotalFrames(code);
  if (!inferredFrames) {
    return { ...animationOutput, fps, durationInSeconds: Number(animation.durationInSeconds) || 5 };
  }
  const inferredSeconds = Number((inferredFrames / fps).toFixed(3));
  const currentSeconds = Number(animation.durationInSeconds) || inferredSeconds;
  // JSX regex inference can see only a tiny nested Sequence when the real
  // timeline is generated dynamically. Never shrink a credible explicit
  // duration to a sub-second partial inference.
  if (currentSeconds > 1 && inferredSeconds < currentSeconds * 0.5) {
    return { ...animationOutput, fps, durationInSeconds: currentSeconds };
  }
  if (Math.abs(currentSeconds - inferredSeconds) > 0.05) {
    return { ...animationOutput, fps, durationInSeconds: inferredSeconds };
  }
  return { ...animationOutput, fps, durationInSeconds: currentSeconds };
}
