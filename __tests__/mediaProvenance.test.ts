import { describe, expect, it } from 'vitest';
import { resolveExplicitTurnMediaIndices } from '@/lib/media-provenance';

describe('explicit turn media provenance', () => {
  it('allows the current upload batch without inspecting the request wording', () => {
    expect(resolveExplicitTurnMediaIndices({
      totalMediaCount: 5,
      userMessage: '任意语言都不影响结果',
      turnMediaCount: 2,
    })).toEqual([4, 5]);
  });

  it('allows formal Media Index references and rejects implicit selected media', () => {
    expect(resolveExplicitTurnMediaIndices({
      totalMediaCount: 5,
      userMessage: 'Use @2 and <<<media_4>>>',
    })).toEqual([2, 4]);
    expect(resolveExplicitTurnMediaIndices({
      totalMediaCount: 5,
      userMessage: 'Make the music louder',
    })).toEqual([]);
  });

  it('falls back to structured attachment counts when turnMediaCount is absent', () => {
    expect(resolveExplicitTurnMediaIndices({
      totalMediaCount: 6,
      userMessage: '',
      referenceImageCount: 2,
      uploadedVideoCount: 1,
    })).toEqual([4, 5, 6]);
  });
});
