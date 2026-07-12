import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { captionsFromTranscript, makeCaptionCueSheet, validateCaptionCues } from '../src/lib/caption-cues';
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
      requestId: 'request-1',
      durationMs: 1800,
    });
  });

  it('rejects absent, malformed, unordered, and out-of-range cues', () => {
    expect(validateCaptionCues([], 2)).toContain('props.captions');
    expect(validateCaptionCues([{ word: 'a', startMs: 10, endMs: 5 }], 2)).toContain('invalid endMs');
    expect(validateCaptionCues([
      { word: 'b', startMs: 500, endMs: 600 },
      { word: 'a', startMs: 100, endMs: 200 },
    ], 2)).toContain('chronological');
    expect(validateCaptionCues([{ word: 'late', startMs: 2100, endMs: 2200 }], 2)).toContain('composition ends');
    expect(validateCaptionCues(captionsFromTranscript(transcript), 2)).toBeNull();
  });

  it('injects one shared caption renderer into preview and export scopes', () => {
    const root = path.resolve(__dirname, '..');
    const preview = fs.readFileSync(path.join(root, 'src/lib/evalRemotionJSX.ts'), 'utf8');
    const exportRuntime = fs.readFileSync(path.join(root, 'src/remotion/DynamicDesign.tsx'), 'utf8');
    const scopeNames = fs.readFileSync(path.join(root, 'src/lib/remotion-code-normalization.ts'), 'utf8');
    expect(preview).toContain('MakaronCaptionOverlay');
    expect(exportRuntime).toContain('MakaronCaptionOverlay');
    expect(scopeNames).toContain("'MakaronCaptionOverlay'");
  });
});
