import type { VolcengineAsrTranscript } from './volcengine-asr';

export interface MakaronWordCaption {
  word: string;
  startMs: number;
  endMs: number;
}

export interface MakaronRenderCaption extends MakaronWordCaption {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface MakaronCaptionCueSheet {
  version: '1.0';
  source: 'volcengine-asr';
  lexicalSource: 'volcengine-asr' | 'voiceover-script';
  requestId: string;
  durationMs: number | null;
  captions: MakaronWordCaption[];
}

const REFERENCE_TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’._+-][\p{L}\p{N}]+)*|[，。！？、；：,.!?;:]/gu;
const REFERENCE_PUNCTUATION = /^[，。！？、；：,.!?;:]$/u;

export function captionTokensFromReferenceText(text: string): string[] {
  const tokens: string[] = [];
  let previousEnd = 0;
  for (const match of text.matchAll(REFERENCE_TOKEN)) {
    const token = match[0];
    const matchIndex = match.index ?? previousEnd;
    const gap = text.slice(previousEnd, matchIndex);
    previousEnd = matchIndex + token.length;
    if (REFERENCE_PUNCTUATION.test(token)) {
      if (tokens.length > 0) tokens[tokens.length - 1] += token;
      continue;
    }
    tokens.push(`${tokens.length > 0 && /\s/u.test(gap) ? ' ' : ''}${token}`);
  }
  return tokens;
}

export function alignCaptionWordsToReference(
  captions: MakaronWordCaption[],
  referenceText?: string,
): MakaronWordCaption[] {
  if (!referenceText?.trim()) return captions;
  const referenceTokens = captionTokensFromReferenceText(referenceText);
  if (referenceTokens.length !== captions.length) return captions;
  return captions.map((caption, index) => ({
    ...caption,
    word: referenceTokens[index],
  }));
}

export function captionsFromTranscript(
  transcript: VolcengineAsrTranscript,
  referenceText?: string,
): MakaronWordCaption[] {
  const captions = transcript.utterances.flatMap(utterance => utterance.words)
    .filter(word => (
      word.text.trim().length > 0
      && typeof word.startMs === 'number'
      && Number.isFinite(word.startMs)
      && typeof word.endMs === 'number'
      && Number.isFinite(word.endMs)
      && word.endMs > word.startMs
    ))
    .map(word => ({
      word: word.text.trim(),
      startMs: word.startMs as number,
      endMs: word.endMs as number,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return alignCaptionWordsToReference(captions, referenceText);
}

export function makeCaptionCueSheet(
  transcript: VolcengineAsrTranscript,
  referenceText?: string,
): MakaronCaptionCueSheet {
  const rawCaptions = captionsFromTranscript(transcript);
  const referenceTokens = referenceText ? captionTokensFromReferenceText(referenceText) : [];
  const canAlignReference = referenceTokens.length > 0 && referenceTokens.length === rawCaptions.length;
  return {
    version: '1.0',
    source: 'volcengine-asr',
    lexicalSource: canAlignReference ? 'voiceover-script' : 'volcengine-asr',
    requestId: transcript.requestId,
    durationMs: transcript.durationMs,
    captions: canAlignReference
      ? alignCaptionWordsToReference(rawCaptions, referenceText)
      : rawCaptions,
  };
}

export function readCaptionCueSheet(value: unknown): MakaronWordCaption[] | null {
  if (Array.isArray(value)) return value as MakaronWordCaption[];
  if (!value || typeof value !== 'object') return null;
  const captions = (value as Record<string, unknown>).captions;
  return Array.isArray(captions) ? captions as MakaronWordCaption[] : null;
}

export function addCaptionRenderingAliases(
  captions: MakaronWordCaption[],
  fps: number,
): MakaronRenderCaption[] {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return captions.map(cue => ({
    ...cue,
    text: cue.word,
    startFrame: Math.round(cue.startMs / 1000 * safeFps),
    endFrame: Math.max(
      Math.round(cue.startMs / 1000 * safeFps) + 1,
      Math.round(cue.endMs / 1000 * safeFps),
    ),
  }));
}

export function validateCaptionCues(
  captions: unknown,
  durationSeconds?: number,
): string | null {
  if (!Array.isArray(captions) || captions.length === 0) {
    return 'Subtitles are required, but props.captions has no word-level timing cues. Pass the captionCuePath returned by transcribe_audio in composition props.';
  }

  const durationMs = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    ? durationSeconds * 1000
    : null;
  let previousStart = -1;
  for (const [index, cue] of captions.entries()) {
    if (!cue || typeof cue !== 'object') return `Caption cue ${index + 1} must be an object.`;
    const { word, startMs, endMs } = cue as Record<string, unknown>;
    if (typeof word !== 'string' || word.trim().length === 0) return `Caption cue ${index + 1} has no word.`;
    if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return `Caption cue ${index + 1} has an invalid startMs.`;
    if (typeof endMs !== 'number' || !Number.isFinite(endMs) || endMs <= startMs) return `Caption cue ${index + 1} has an invalid endMs.`;
    if (startMs < previousStart) return `Caption cue ${index + 1} is not in chronological order.`;
    if (durationMs !== null && startMs >= durationMs) return `Caption cue ${index + 1} starts after the composition ends.`;
    if (durationMs !== null && endMs > durationMs + 250) return `Caption cue ${index + 1} ends after the composition ends.`;
    previousStart = startMs;
  }
  return null;
}
