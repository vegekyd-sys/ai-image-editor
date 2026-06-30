import { describe, expect, it } from 'vitest';
import {
  extractRenderableInlineVideoUrl,
  removeAllInlineVideoUrls,
  removeRenderableInlineVideoUrls,
  resolveInlineVideoCandidate,
} from '../src/lib/cui-video-url';

describe('CUI inline video URL filtering', () => {
  it('does not render Evolink provider URLs as inline videos', () => {
    const text = 'submitted https://api.evolink.ai/v1/files/output.mp4?token=abc';

    expect(extractRenderableInlineVideoUrl(text)).toBeNull();
    expect(removeRenderableInlineVideoUrls(text)).toBe(text);
  });

  it('renders final delivery mp4 URLs and removes only that URL from markdown text', () => {
    const text = 'done\nhttps://storage.example.com/final.mp4\nsnap:abc';

    expect(extractRenderableInlineVideoUrl(text)).toBe('https://storage.example.com/final.mp4');
    expect(removeRenderableInlineVideoUrls(text)).toBe('done\n\nsnap:abc');
  });

  it('uses snap video metadata before markdown URLs, including provider URLs', () => {
    const text = [
      'done',
      'https://api.evolink.ai/v1/files/output.mp4?token=abc',
      'snap:11111111-1111-1111-1111-111111111111',
    ].join('\n');
    const snapshots = [{
      id: '11111111-1111-1111-1111-111111111111',
      videoMeta: { videoUrl: 'https://storage.example.com/final.mp4' },
    }];

    expect(resolveInlineVideoCandidate(text, snapshots)).toEqual({
      url: 'https://storage.example.com/final.mp4',
      navId: '11111111-1111-1111-1111-111111111111',
      videoSnap: snapshots[0],
      source: 'snapshot',
    });
    expect(removeAllInlineVideoUrls(text)).toBe('done\n\nsnap:11111111-1111-1111-1111-111111111111');
  });

  it('allows provider URLs only when they come from a known video snapshot', () => {
    const providerUrl = 'https://api.evolink.ai/v1/files/output.mp4?token=abc';

    expect(resolveInlineVideoCandidate(providerUrl, [])).toBeNull();
    expect(resolveInlineVideoCandidate(`done\n${providerUrl}\nsnap:22222222-2222-2222-2222-222222222222`, [{
      id: '22222222-2222-2222-2222-222222222222',
      videoMeta: { videoUrl: providerUrl },
    }])?.source).toBe('snapshot');
  });
});
