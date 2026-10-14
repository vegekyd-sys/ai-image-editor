/** Real container/overlay acceptance with a local TEST SIGNAL, not an AI
 * quality sample. No model calls, no cloud writes, no runtime credentials.
 * Usage: node --import tsx .../verify-media.ts <output-dir> [silent-original.mp4]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { probeVideoMetadata } from '../../src/lib/video-metadata';
import { assertEmbeddedAudioAssets } from '../../src/lib/studio-run/embedded-audio';

async function main() {
  const root = path.resolve(process.argv[2] || '.tmp/native-media-acceptance');
  await mkdir(root, { recursive: true });
  const run = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: root, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  run(['-f', 'lavfi', '-i', 'color=c=0x123b51:s=480x854:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'fixture-av.mp4']);
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 480\nPlayResY: 854\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,26,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,2,0,2,32,32,80,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,LOCAL TEST SIGNAL\\NEmbedded sound preserved\n`;
  await writeFile(path.join(root, 'overlay.ass'), ass);
  run(['-i', 'fixture-av.mp4', '-vf', 'ass=overlay.ass', '-c:v', 'libx264', '-c:a', 'copy', '-movflags', '+faststart', 'fixture-overlay.mp4']);
  const inspect = async (filename: string) => probeVideoMetadata(await readFile(path.resolve(root, filename)));
  const before = await inspect('fixture-av.mp4');
  const after = await inspect('fixture-overlay.mp4');
  assert.equal(before.hasAudio, true); assert.equal(after.hasAudio, true);
  assert.equal(before.duration, after.duration);
  await assertEmbeddedAudioAssets({ assets: [{ id: 'native-signal', type: 'video', path: 'fixture-overlay.mp4', hasAudio: true }], probe: inspect });
  const pcm = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, file), '-map', '0:a:0', '-f', 's16le', '-'], { maxBuffer: 4 * 1024 * 1024 });
  const audioUnchanged = pcm('fixture-av.mp4').equals(pcm('fixture-overlay.mp4'));
  assert.equal(audioUnchanged, true);
  let originalSilentRejected: boolean | undefined;
  if (process.argv[3]) {
    const original = path.resolve(process.argv[3]);
    assert.equal(probeVideoMetadata(await readFile(original)).hasAudio, false);
    await assert.rejects(assertEmbeddedAudioAssets({ assets: [{ id: 'original-silent', type: 'video', path: original, hasAudio: true }], probe: inspect }), /no verified embedded audio/);
    originalSilentRejected = true;
  }
  const result = { scope: 'Real MP4 transport and caption-overlay acceptance; synthetic test signal, not generation quality', before, after, audioUnchanged, originalSilentRejected };
  await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
