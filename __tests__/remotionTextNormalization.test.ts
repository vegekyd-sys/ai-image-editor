import { describe, expect, it } from 'vitest';
import { normalizeRemotionTextValue } from '@/lib/remotion-text-normalization';

describe('Remotion text normalization', () => {
  it('normalizes escaped line breaks recursively before renderer submission', () => {
    expect(normalizeRemotionTextValue({
      title: 'WHICH COLOR\\nWOULD YOU PLAY?',
      scenes: [{ label: 'FIRST\\r\\nSECOND' }],
      nested: ['A\\rB', 42],
    })).toEqual({
      title: 'WHICH COLOR\nWOULD YOU PLAY?',
      scenes: [{ label: 'FIRST\nSECOND' }],
      nested: ['A\nB', 42],
    });
  });

  it('does not mutate unrelated strings or the input object', () => {
    const input = { url: 'https://example.com/news', title: 'One line' };
    const output = normalizeRemotionTextValue(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
