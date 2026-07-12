import type { VolcengineAsrTranscript } from './volcengine-asr';

export interface MakaronWordCaption {
  word: string;
  startMs: number;
  endMs: number;
}

export interface MakaronCaptionCueSheet {
  version: '1.0';
  source: 'volcengine-asr';
  requestId: string;
  durationMs: number | null;
  captions: MakaronWordCaption[];
}

export function captionsFromTranscript(transcript: VolcengineAsrTranscript): MakaronWordCaption[] {
  return transcript.utterances.flatMap(utterance => utterance.words)
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
}

export function makeCaptionCueSheet(transcript: VolcengineAsrTranscript): MakaronCaptionCueSheet {
  return {
    version: '1.0',
    source: 'volcengine-asr',
    requestId: transcript.requestId,
    durationMs: transcript.durationMs,
    captions: captionsFromTranscript(transcript),
  };
}

export function readCaptionCueSheet(value: unknown): MakaronWordCaption[] | null {
  if (Array.isArray(value)) return value as MakaronWordCaption[];
  if (!value || typeof value !== 'object') return null;
  const captions = (value as Record<string, unknown>).captions;
  return Array.isArray(captions) ? captions as MakaronWordCaption[] : null;
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
