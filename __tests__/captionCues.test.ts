import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCaptionRenderingAliases, alignCaptionWordsToReference, captionTokensFromReferenceText, captionsFromTranscript, makeCaptionCueSheet, validateCaptionCues } from '../src/lib/caption-cues';
import type { VolcengineAsrTranscript } from '../src/lib/volcengine-asr';

const transcript: VolcengineAsrTranscript = {
  provider: 'volcengine',
  model: 'bigmodel-flash',
  resourceId: 'test',
  requestId: 'request-1',
  text: '你好 Makaron',
  durationMs: 1800,
  utterances: [{
    text: '你好 Makaron',
    startMs: 100,
    endMs: 1700,
    words: [
      { text: 'Makaron', startMs: 900, endMs: 1600 },
      { text: '你好', startMs: 100, endMs: 700 },
      { text: '', startMs: 710, endMs: 800 },
      { text: 'bad', startMs: null, endMs: null },
    ],
  }],
  createdAt: '2026-07-12T00:00:00.000Z',
};

describe('word-level caption cues', () => {
  it('turns ASR words into a durable chronological cue sheet', () => {
    expect(captionsFromTranscript(transcript)).toEqual([
      { word: '你好', startMs: 100, endMs: 700 },
      { word: 'Makaron', startMs: 900, endMs: 1600 },
    ]);
    expect(makeCaptionCueSheet(transcript)).toMatchObject({
      version: '1.0',
      source: 'volcengine-asr',
      lexicalSource: 'volcengine-asr',
      requestId: 'request-1',
      durationMs: 1800,
    });
  });

  it('uses the exact voiceover wording and punctuation without changing ASR timing', () => {
    const raw = [
      { word: '打', startMs: 100, endMs: 200 },
      { word: '开', startMs: 200, endMs: 300 },
      { word: 'Macrom', startMs: 300, endMs: 900 },
    ];
    expect(captionTokensFromReferenceText('打开 Makaron。')).toEqual(['打', '开', ' Makaron。']);
    expect(alignCaptionWordsToReference(raw, '打开 Makaron。')).toEqual([
      { word: '打', startMs: 100, endMs: 200 },
      { word: '开', startMs: 200, endMs: 300 },
      { word: ' Makaron。', startMs: 300, endMs: 900 },
    ]);
    expect(alignCaptionWordsToReference(raw, 'token count')).toBe(raw);
    expect(makeCaptionCueSheet({
      ...transcript,
      utterances: [{
        text: '打开 Macrom',
        startMs: 100,
        endMs: 900,
        words: raw.map(cue => ({ text: cue.word, startMs: cue.startMs, endMs: cue.endMs })),
      }],
    }, '打开 Makaron。')).toMatchObject({
      lexicalSource: 'voiceover-script',
      captions: [
        { word: '打', startMs: 100, endMs: 200 },
        { word: '开', startMs: 200, endMs: 300 },
        { word: ' Makaron。', startMs: 300, endMs: 900 },
      ],
    });
    expect(captionTokensFromReferenceText('Makaron， Pixel Wizard 把')).toEqual([
      'Makaron，',
      ' Pixel',
      ' Wizard',
      ' 把',
    ]);
  });

  it('rejects absent, malformed, unordered, and out-of-range cues', () => {
    expect(validateCaptionCues([], 2)).toContain('props.captions');
    expect(validateCaptionCues([{ word: 'a', startMs: 10, endMs: 5 }], 2)).toContain('invalid endMs');
    expect(validateCaptionCues([
      { word: 'b', startMs: 500, endMs: 600 },
      { word: 'a', startMs: 100, endMs: 200 },
    ], 2)).toContain('chronological');
    expect(validateCaptionCues([{ word: 'late', startMs: 2100, endMs: 2200 }], 2)).toContain('composition ends');
    expect(validateCaptionCues([{ word: 'long', startMs: 1900, endMs: 2400 }], 2)).toContain('ends after');
    expect(validateCaptionCues(captionsFromTranscript(transcript), 2)).toBeNull();
  });

  it('provides millisecond and frame aliases without choosing a visual style', () => {
    expect(addCaptionRenderingAliases(captionsFromTranscript(transcript), 30)).toEqual([
      { word: '你好', text: '你好', startMs: 100, endMs: 700, startFrame: 3, endFrame: 21 },
      { word: 'Makaron', text: 'Makaron', startMs: 900, endMs: 1600, startFrame: 27, endFrame: 48 },
    ]);
  });

  it('does not force one shared visual caption renderer', () => {
    const root = path.resolve(__dirname, '..');
    const preview = fs.readFileSync(path.join(root, 'src/lib/evalRemotionJSX.ts'), 'utf8');
    const exportRuntime = fs.readFileSync(path.join(root, 'src/remotion/DynamicDesign.tsx'), 'utf8');
    const scopeNames = fs.readFileSync(path.join(root, 'src/lib/remotion-code-normalization.ts'), 'utf8');
    expect(preview).not.toContain('MakaronCaptionOverlay');
    expect(exportRuntime).not.toContain('MakaronCaptionOverlay');
    expect(scopeNames).not.toContain('MakaronCaptionOverlay');
  });
});
