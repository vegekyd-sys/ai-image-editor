import { describe, expect, it } from 'vitest';
import {
  formatSourceRangeHint,
  normalizeExternalVideoRange,
  sourceRangeFromVideoMeta,
  sourceRangeIdentity,
} from '@/lib/media-source-range';

describe('external video source range protocol', () => {
  it('normalizes the public snake_case contract and derives duration', () => {
    expect(normalizeExternalVideoRange({
      source_url: 'https://cdn.example.com/source.mp4?signature=one',
      start_sec: '12.5',
      end_sec: 19,
      source_uri: 'scene://project-a/asset-b',
      project_id: 'project-a',
      asset_id: 'asset-b',
      file_name: 'factory.mp4',
      description: 'Racket frame molding\nEvidence: resin is visible around the rim',
      width: 1080,
      height: 1920,
    })).toEqual({
      source_url: 'https://cdn.example.com/source.mp4?signature=one',
      start_sec: 12.5,
      end_sec: 19,
      duration: 6.5,
      source_uri: 'scene://project-a/asset-b',
      project_id: 'project-a',
      asset_id: 'asset-b',
      file_name: 'factory.mp4',
      description: 'Racket frame molding\nEvidence: resin is visible around the rim',
      width: 1080,
      height: 1920,
    });
  });

  it.each([
    [{ source_url: 'file:///tmp/source.mp4', start_sec: 0, end_sec: 1 }, 'http or https'],
    [{ source_url: 'https://cdn.example.com/source.mp4', start_sec: -1, end_sec: 1 }, 'start_sec'],
    [{ source_url: 'https://cdn.example.com/source.mp4', start_sec: 2, end_sec: 2 }, 'end_sec'],
  ])('rejects invalid protocol input %#', (input, message) => {
    expect(() => normalizeExternalVideoRange(input)).toThrow(message);
  });

  it('deduplicates signed delivery URLs by durable identity and exact range', () => {
    const first = {
      source_url: 'https://cdn.example.com/source.mp4?signature=one',
      source_uri: 'scene://project-a/asset-b',
      start_sec: 3,
      end_sec: 8,
    };
    const refreshed = { ...first, source_url: 'https://cdn.example.com/source.mp4?signature=two' };

    expect(sourceRangeIdentity(first)).toBe(sourceRangeIdentity(refreshed));
    expect(sourceRangeIdentity({ ...refreshed, end_sec: 9 })).not.toBe(sourceRangeIdentity(first));
    expect(sourceRangeIdentity({ ...first, source_uri: undefined })).not.toBe(
      sourceRangeIdentity({ ...refreshed, source_uri: undefined }),
    );
  });

  it('round-trips persisted VideoMeta and emits an Agent-readable hint', () => {
    const range = sourceRangeFromVideoMeta({
      sourceRange: {
        source_url: 'https://cdn.example.com/source.mp4',
        start_sec: 4.25,
        end_sec: 7.75,
        asset_id: 'asset-b',
      },
    });

    expect(range).toEqual({
      source_url: 'https://cdn.example.com/source.mp4',
      start_sec: 4.25,
      end_sec: 7.75,
      asset_id: 'asset-b',
    });
    expect(formatSourceRangeHint(range)).toContain('start_sec=4.25; end_sec=7.75');
  });
});
