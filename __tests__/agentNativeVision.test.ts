import { describe, expect, it } from 'vitest';
import {
  buildNativeVisionUserContent,
  resolveAnalyzeImageProvider,
  selectNativeVisionImages,
} from '@/lib/agent-image-analysis';

describe('Agent native image vision', () => {
  const snapshots = [
    { id: 'first', image_url: 'https://cdn.example.com/first.jpg', type: 'image' },
    { id: 'video', image_url: 'https://cdn.example.com/video.mp4', type: 'video' },
    { id: 'design', image_url: 'https://cdn.example.com/design.jpg', type: 'image', design_path: 'code/design.json' },
    { id: 'fourth', image_url: 'https://cdn.example.com/fourth.jpg', type: 'image' },
  ];

  it('uses the selected Agent for vision except for text-only models', () => {
    expect(resolveAnalyzeImageProvider({
      spec: { supportsImageInput: true, provider: 'openrouter' },
    })).toBe('openrouter');
    expect(resolveAnalyzeImageProvider({
      spec: { supportsImageInput: false, provider: 'deepseek' },
    })).toBe('gemini-api');
  });

  it('attaches the current still image on an ordinary multimodal turn', () => {
    expect(selectNativeVisionImages(snapshots, {
      supportsImageInput: true,
      currentSnapshotIndex: 0,
    })).toEqual([
      { source: 'https://cdn.example.com/first.jpg', mediaIndex: 1 },
    ]);
  });

  it('attaches every still image in a fresh batch while excluding videos and compositions', () => {
    expect(selectNativeVisionImages(snapshots, {
      supportsImageInput: true,
      currentSnapshotIndex: 0,
      turnMediaCount: 4,
    })).toEqual([
      { source: 'https://cdn.example.com/first.jpg', mediaIndex: 1 },
      { source: 'https://cdn.example.com/fourth.jpg', mediaIndex: 4 },
    ]);
  });

  it('keeps the current edit target when the user explicitly references another image', () => {
    expect(selectNativeVisionImages(snapshots, {
      supportsImageInput: true,
      currentSnapshotIndex: 3,
      explicitMediaIndices: [1],
    })).toEqual([
      { source: 'https://cdn.example.com/fourth.jpg', mediaIndex: 4 },
      { source: 'https://cdn.example.com/first.jpg', mediaIndex: 1 },
    ]);
  });

  it('selects exact turn snapshots instead of assuming they are the trailing rows', () => {
    expect(selectNativeVisionImages(snapshots, {
      supportsImageInput: true,
      currentSnapshotIndex: 0,
      turnMediaCount: 2,
      turnMediaSnapshotIds: ['first', 'video'],
    })).toEqual([
      { source: 'https://cdn.example.com/first.jpg', mediaIndex: 1 },
    ]);
  });

  it('does not attach images to a text-only Agent', () => {
    expect(selectNativeVisionImages(snapshots, {
      supportsImageInput: false,
      currentSnapshotIndex: 0,
      turnMediaCount: 4,
    })).toEqual([]);
  });

  it('builds one user message containing both Media Index labels and images', () => {
    const content = buildNativeVisionUserContent('Compare these.', [
      { source: 'https://cdn.example.com/first.jpg', mediaIndex: 1 },
      { source: 'data:image/png;base64,AAAA', mediaIndex: 4 },
    ]);

    expect(content[0]).toEqual({ type: 'text', text: 'Compare these.' });
    expect(content[1]).toEqual({ type: 'text', text: 'Image attached for <<<media_1>>>:' });
    expect(content[2]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' });
    expect((content[2] as { data: URL }).data.href).toBe('https://cdn.example.com/first.jpg');
    expect(content[3]).toEqual({ type: 'text', text: 'Image attached for <<<media_4>>>:' });
    expect(content[4]).toEqual({
      type: 'file',
      data: { type: 'data', data: 'AAAA' },
      mediaType: 'image/png',
    });
  });
});
