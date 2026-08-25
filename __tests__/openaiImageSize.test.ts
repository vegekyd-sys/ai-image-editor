import { describe, expect, it } from 'vitest';
import { aspectRatioToSize } from '@/lib/models/openai';

describe('GPT Image 2 size mapping', () => {
  it('uses only GPT Image 2 supported generation sizes', () => {
    expect(aspectRatioToSize('16:9')).toBe('1536x1024');
    expect(aspectRatioToSize('9:16')).toBe('1024x1536');
    expect(aspectRatioToSize('1:1')).toBe('1024x1024');
    expect(aspectRatioToSize()).toBe('auto');
  });
});
