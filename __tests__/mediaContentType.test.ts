import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { mediaContentTypeFor, mediaContentTypeOrBinary } from '@/lib/media-content-type';

describe('media content type', () => {
  it('maps audio outputs (run_code FFmpeg .wav etc.) to audio/* instead of octet-stream', () => {
    expect(mediaContentTypeFor('p1/media/1762440000000-master.wav')).toBe('audio/wav');
    expect(mediaContentTypeFor('mix.MP3')).toBe('audio/mpeg');
    expect(mediaContentTypeFor('.m4a')).toBe('audio/mp4');
    expect(mediaContentTypeFor('aac')).toBe('audio/aac');
    expect(mediaContentTypeFor('a.ogg')).toBe('audio/ogg');
    expect(mediaContentTypeFor('a.oga')).toBe('audio/ogg');
    expect(mediaContentTypeFor('a.opus')).toBe('audio/ogg');
    expect(mediaContentTypeFor('a.flac')).toBe('audio/flac');
  });

  it('keeps the previous video and image mappings', () => {
    expect(mediaContentTypeFor('clip.mp4')).toBe('video/mp4');
    expect(mediaContentTypeFor('clip.m4v')).toBe('video/mp4');
    expect(mediaContentTypeFor('clip.mov')).toBe('video/quicktime');
    expect(mediaContentTypeFor('clip.webm')).toBe('video/webm');
    expect(mediaContentTypeFor('a.jpg')).toBe('image/jpeg');
    expect(mediaContentTypeFor('a.jpeg')).toBe('image/jpeg');
    expect(mediaContentTypeFor('a.png')).toBe('image/png');
    expect(mediaContentTypeFor('a.webp')).toBe('image/webp');
    expect(mediaContentTypeFor('a.gif')).toBe('image/gif');
    expect(mediaContentTypeFor('a.avif')).toBe('image/avif');
  });

  it('handles URLs with query strings and non-media paths', () => {
    expect(mediaContentTypeFor('https://cdn.makaron.app/storage/v1/object/public/images/u/workspace/p/media/x.wav?t=1')).toBe('audio/wav');
    expect(mediaContentTypeFor('https://cdn.makaron.app/a.b/file')).toBeNull();
    expect(mediaContentTypeFor('notes.md')).toBeNull();
    expect(mediaContentTypeFor('')).toBeNull();
    expect(mediaContentTypeOrBinary('archive.bin')).toBe('application/octet-stream');
    expect(mediaContentTypeOrBinary('song.wav')).toBe('audio/wav');
  });

  it('covers exactly the extensions the R2 cache Worker treats as media', () => {
    const worker = readFileSync(path.join(__dirname, '../services/media-r2-cache/src/worker.mjs'), 'utf8');
    const source = /const MEDIA_EXT = \/\\\.\(\?:([^)]+)\)\$\/i;/.exec(worker)?.[1];
    expect(source).toBeTruthy();
    const workerExts = source!.split('|').flatMap(e => (e === 'jpe?g' ? ['jpg', 'jpeg'] : [e]));
    for (const ext of workerExts) expect(mediaContentTypeFor(ext), ext).not.toBeNull();
    expect(mediaContentTypeFor('heic')).toBeNull();
  });
});
