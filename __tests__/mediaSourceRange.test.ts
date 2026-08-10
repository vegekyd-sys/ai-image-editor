import { describe, expect, it } from 'vitest';
import {
  formatSourceRangeHint,
  normalizeExternalVideoRange,
  sourceRangeFromVideoMeta,
  sourceRangeIdentity,
} from '@/lib/media-source-range';

describe('external video source range protocol', () => {
  it('normalizes the four-field public contract, drops provider metadata, and derives duration', () => {
    expect(normalizeExternalVideoRange({
      source_url: 'https://cdn.example.com/source.mp4?signature=one',
      start: '12.5',
      end: 19,
      source_uri: 'scene://project-a/asset-b',
      project_id: 'project-a',
      asset_id: 'asset-b',
      file_name: 'factory.mp4',
      description: 'Racket frame molding\nEvidence: resin is visible around the rim',
    })).toEqual({
      source_url: 'https://cdn.example.com/source.mp4?signature=one',
      start_sec: 12.5,
      end_sec: 19,
      duration: 6.5,
      description: 'Racket frame molding\nEvidence: resin is visible around the rim',
    });
  });

  it.each([
    [{ source_url: 'file:///tmp/source.mp4', start: 0, end: 1 }, 'http or https'],
    [{ source_url: 'https://cdn.example.com/source.mp4', start: -1, end: 1 }, 'start'],
    [{ source_url: 'https://cdn.example.com/source.mp4', start: 2, end: 2 }, 'end'],
  ])('rejects invalid protocol input %#', (input, message) => {
    expect(() => normalizeExternalVideoRange(input)).toThrow(message);
  });

  it('accepts legacy time aliases but does not retain legacy provider keys', () => {
    expect(normalizeExternalVideoRange({
      source_url: 'https://cdn.example.com/legacy.mp4',
      start_sec: 1.5,
      end_sec: 4,
      source_uri: 'legacy://provider/item',
      asset_id: 'legacy-id',
      description: 'Legacy handoff',
    })).toEqual({
      source_url: 'https://cdn.example.com/legacy.mp4',
      start_sec: 1.5,
      end_sec: 4,
      duration: 2.5,
      description: 'Legacy handoff',
    });
  });

  it('uses the opaque stable URL and exact range as identity', () => {
    const first = {
      source_url: 'https://cdn.example.com/source.mp4?capability=stable',
      start_sec: 3,
      end_sec: 8,
    };
    const same = { ...first };
    const differentUrl = { ...first, source_url: 'https://cdn.example.com/source.mp4?capability=other' };

    expect(sourceRangeIdentity(first)).toBe(sourceRangeIdentity(same));
    expect(sourceRangeIdentity(differentUrl)).not.toBe(sourceRangeIdentity(first));
    expect(sourceRangeIdentity({ ...first, end_sec: 9 })).not.toBe(sourceRangeIdentity(first));
  });

  it('round-trips persisted VideoMeta and emits an Agent-readable hint', () => {
    const range = sourceRangeFromVideoMeta({
      sourceRange: {
        source_url: 'https://cdn.example.com/source.mp4',
        start_sec: 4.25,
        end_sec: 7.75,
        asset_id: 'legacy-provider-key',
      },
    });

    expect(range).toEqual({
      source_url: 'https://cdn.example.com/source.mp4',
      start_sec: 4.25,
      end_sec: 7.75,
    });
    expect(formatSourceRangeHint(range)).toContain('start_sec=4.25; end_sec=7.75');
  });
});
