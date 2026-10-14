import { describe, expect, it } from 'vitest';
import { probeMP4HasAudio } from '@/lib/mp4-probe';
import { probeVideoMetadata } from '@/lib/video-metadata';
import { assertEmbeddedAudioAssets, createStudioRun, putStudioArtifact, validateStudioArtifact } from '@/lib/studio-run';

function box(type: string, ...children: Buffer[]): Buffer {
  const payload = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}
function movie(audio: boolean): Buffer {
  const handler = Buffer.alloc(12);
  handler.write(audio ? 'soun' : 'vide', 8);
  return box('moov', box('trak', box('mdia', box('hdlr', handler))));
}
function run() {
  const value = createStudioRun({ agentRunId: 'agent', projectId: 'project', recipe: 'avatar-spokesperson', title: 'Native AV with editable captions', approvalPolicy: 'auto', deliveryPromise: { durationSeconds: 25, width: 720, height: 1280, fps: 30, renderRuntime: 'remotion', compositionMode: 'editable', audioRequired: true, subtitlesRequired: true } });
  for (const stage of ['brief', 'proposal', 'script', 'storyboard'] as const) value.stages[stage].status = 'completed';
  value.currentStage = 'assets';
  return value;
}
const video = { id: 'native-av', type: 'video', path: 'https://example.test/native.mp4', source: 'generated', sceneIds: ['scene'], status: 'ready', costUsd: 3.45 };
function manifest(asset = video) {
  return { version: '1.0', assets: [asset], totalCostUsd: 3.45, missingAssetIds: [] };
}

describe('native audiovisual assets in Studio', () => {
  it('accepts an audible generated video without manufacturing a separate voice asset', async () => {
    const asset = { ...video, hasAudio: true };
    const parsed = validateStudioArtifact('assets', manifest(asset)) as { assets: typeof asset[] };
    expect(parsed.assets[0].hasAudio).toBe(true);
    await assertEmbeddedAudioAssets({ assets: parsed.assets, probe: async () => probeVideoMetadata(movie(true)) });
    const result = putStudioArtifact({ run: run(), stage: 'assets', artifact: manifest(asset), artifactPath: 'assets.json' });
    expect(result.run.stages.assets.status).toBe('completed');
    expect(result.run.currentStage).toBe('composition');
  });

  it.each([undefined, false])('rejects a video with hasAudio=%s when sound is promised', hasAudio => {
    expect(() => putStudioArtifact({ run: run(), stage: 'assets', artifact: manifest({ ...video, hasAudio } as typeof video), artifactPath: 'assets.json' })).toThrow('required audio asset');
  });

  it('rejects a forged hasAudio claim against the actual silent media', async () => {
    await expect(assertEmbeddedAudioAssets({ assets: [{ ...video, hasAudio: true }], probe: async () => probeVideoMetadata(movie(false)) })).rejects.toThrow('no verified embedded audio track');
  });

  it('fails closed when media is missing or unparseable', async () => {
    for (const measured of [null, probeVideoMetadata(Buffer.from('not an mp4'))]) {
      await expect(assertEmbeddedAudioAssets({ assets: [{ ...video, hasAudio: true }], probe: async () => measured })).rejects.toThrow('no verified embedded audio track');
    }
  });
});

describe('MP4 audio track inspection', () => {
  it('recognizes sound track handlers and ignores a sound-like payload', () => {
    expect(probeMP4HasAudio(movie(true))).toBe(true);
    expect(probeMP4HasAudio(Buffer.concat([box('mdat', Buffer.from('hdlr soun')), movie(false)]))).toBe(false);
    expect(probeMP4HasAudio(box('mdat', Buffer.from('soun')))).toBeUndefined();
  });
  it('fails closed for truncated boxes even after an audio-looking header', () => {
    expect(probeMP4HasAudio(movie(true).subarray(0, -1))).toBeUndefined();
    const invalid = movie(true);
    invalid.writeUInt32BE(1, 0);
    expect(probeMP4HasAudio(invalid)).toBeUndefined();
  });
  it('supports large-size containers and zero-size final boxes', () => {
    const standard = movie(true);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1); header.write('moov', 4); header.writeBigUInt64BE(BigInt(standard.length + 8), 8);
    expect(probeMP4HasAudio(Buffer.concat([header, standard.subarray(8)]))).toBe(true);
    standard.writeUInt32BE(0);
    expect(probeMP4HasAudio(standard)).toBe(true);
  });
});
