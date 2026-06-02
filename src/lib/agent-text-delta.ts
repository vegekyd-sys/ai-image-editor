export type TextDeltaState = {
  accumulatedText: string;
  lastRawText: string;
};

const MIN_PREFIX_DEDUPE_CHARS = 20;

export function createTextDeltaState(): TextDeltaState {
  return { accumulatedText: '', lastRawText: '' };
}

export function normalizeTextDelta(
  event: { delta?: unknown; textDelta?: unknown; text?: unknown },
  state: TextDeltaState,
): string {
  const rawText =
    typeof event.delta === 'string'
      ? event.delta
      : typeof event.textDelta === 'string'
        ? event.textDelta
        : typeof event.text === 'string'
          ? event.text
          : '';

  if (!rawText) return '';

  let delta = rawText;

  if (
    state.lastRawText.length >= MIN_PREFIX_DEDUPE_CHARS &&
    rawText === state.lastRawText
  ) {
    return '';
  }

  if (
    state.accumulatedText.length >= MIN_PREFIX_DEDUPE_CHARS &&
    rawText.startsWith(state.accumulatedText)
  ) {
    delta = rawText.slice(state.accumulatedText.length);
    state.accumulatedText = rawText;
  } else if (
    state.lastRawText.length >= MIN_PREFIX_DEDUPE_CHARS &&
    rawText.startsWith(state.lastRawText)
  ) {
    delta = rawText.slice(state.lastRawText.length);
    state.accumulatedText += delta;
  } else {
    state.accumulatedText += rawText;
  }

  state.lastRawText = rawText;
  return delta;
}
