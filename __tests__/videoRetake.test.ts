// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRetake, validateRetakeRange, retakePrompt, resolveRetakeModel } from '@/lib/video-retake-contract';
import { assembleRetake, extractRetakeContext, extractRetakeBoundaryFrames, inspectRetakeSource } from '@/lib/video-retake-media';
import { filterAndRemapImages } from '@/lib/kling';
import { findFfmpeg } from '@/lib/ffmpeg-runtime';

describe('Retake interval contract', () => {
  it('uses H3 Max by default and keeps explicitly selected editing models', () => {
    expect(resolveRetakeModel()).toBe('fal-h3-max');
    expect(resolveRetakeModel('auto')).toBe('fal-h3-max');
    expect(resolveRetakeModel('seedance-2.5')).toBe('seedance-2.5');
    expect(() => resolveRetakeModel('ltx-2.3-retake')).toThrow(/supports/);
  });
  it('expands reference context without expanding the replacement interval', () => {
    const plan = planRetake({ start: 2, end: 3 }, 10, 'fal-h3-max');
    expect(plan).toMatchObject({ start: 2, end: 3, contextStart: 0, contextEnd: 5, patchOffset: 2, generationDuration: 5 });
    expect(planRetake({ start: 9, end: 10 }, 10, 'seedance-2.5').contextStart).toBe(6);
  });
  it('rejects invalid and unsupported requests before paid submission', () => {
    for (const range of [{ start: NaN, end: 2 }, { start: -1, end: 2 }, { start: 2, end: 2 }, { start: 0, end: 16 }]) {
      expect(() => validateRetakeRange(range, 20)).toThrow();
    }
    expect(() => planRetake({ start: 0, end: 2 }, 1, 'seedance-2.5')).toThrow();
    expect(() => planRetake({ start: 0, end: 2 }, 10, 'minimax-h3-max')).toThrow(/Turbo/);
  });
  it('allows explicitly requested camera cuts instead of overriding a multi-camera edit', () => {
    const prompt = retakePrompt('Use multiple camera angles and cuts', planRetake({ start: 10, end: 23 }, 30, 'seedance-2.5'));
    expect(prompt).toContain('Follow explicitly requested shot cuts');
    expect(prompt).toContain('original source time 10.000-23.000');
    expect(prompt).toContain('Subtract 10.000 seconds');
    expect(prompt).toContain('Only change clip-local 0.000-13.000');
    expect(prompt).not.toContain('Do not add shots, cuts');
  });
  it('retains both native H3 boundary references through prompt selection', () => {
    const plan = planRetake({start:10,end:23},30,'fal-h3-max');
    const prompt = retakePrompt('Use multiple camera angles',plan,true);
    expect(filterAndRemapImages(prompt,['start.jpg','end.jpg']).filteredImages).toEqual(['start.jpg','end.jpg']);
    expect(prompt).toContain('never restart an earlier approach');
    expect(retakePrompt('Use multiple camera angles',planRetake({start:10,end:23},30,'seedance-2.5'))).not.toContain('BOUNDARY CONTINUITY');
  });
  it('maps original timestamps to the requested H3 output duration without locking intervening shots', () => {
    const plan = planRetake({start:17.48,end:23},30.048,'fal-h3-max');
    const prompt = retakePrompt('17.48-19s: low angle. CUT. 19-23s: overhead.',plan,true);
    expect(prompt).toContain('NEW TAKE, 6.000 seconds');
    expect(prompt).toContain('(original timestamp - 17.480) * 1.086957');
    expect(prompt).toContain('output 0.000-6.000 seconds');
    expect(prompt).toContain('they do not lock the camera composition');
    expect(prompt).not.toContain('Preserve subject identity, motion, lighting and every detail');
  });
  it('extracts the first and last contextual frames from the original timebase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retake-boundaries-'));
    const ffmpeg = await findFfmpeg();
    try {
      const src = join(dir, 'source.mp4');
      execFileSync(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=red:s=320x240:r=24:d=3',
        '-f','lavfi','-i','color=blue:s=320x240:r=24:d=3','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264',src]);
      const frames = await extractRetakeBoundaryFrames(readFileSync(src), planRetake({start:1,end:5},6,'fal-h3-max'),24);
      const { default: sharp } = await import('sharp');
      const color = async (buffer: Buffer) => [...(await sharp(buffer).resize(1,1).raw().toBuffer())];
      expect((await color(frames.start))[0]).toBeGreaterThan(200);
      expect((await color(frames.end))[2]).toBeGreaterThan(200);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  },30_000);
  it('assembles only the selected frames and copies original audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retake-test-'));
    const ffmpeg = await findFfmpeg();
    const run = (args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 5 * 1024 * 1024 });
    try {
      const src = join(dir, 'source.mp4'), patch = join(dir, 'patch.mp4');
      run(['-f', 'lavfi', '-i', 'color=red:s=320x240:r=24:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src]);
      run(['-f', 'lavfi', '-i', 'color=blue:s=640x360:r=30:d=5', '-c:v', 'libx264', patch]);
      const source = readFileSync(src), plan = planRetake({ start: 2, end: 3 }, 6, 'fal-h3-max');
      expect((await inspectRetakeSource(source)).duration).toBeCloseTo(6, 1);
      expect((await inspectRetakeSource(await extractRetakeContext(source, plan))).fps).toBe(30);
      const result = await assembleRetake(source, readFileSync(patch), plan);
      expect(result.meta).toMatchObject({ width: 320, height: 240, fps: 24, audioCodec: 'aac' });
      expect(result.meta.duration).toBeCloseTo(6, 1);
      const { writeFileSync } = await import('node:fs');
      const final = join(dir, 'final.mp4'); writeFileSync(final, result.bytes);
      const pixel = (at: number) => [...run(['-ss', String(at), '-i', final, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])];
      expect(pixel(1)[0]).toBeGreaterThan(200);
      expect(pixel(2.5)[2]).toBeGreaterThan(200);
      expect(pixel(4)[0]).toBeGreaterThan(200);
      const audioHash = (file: string) => run(['-i', file, '-map', '0:a', '-c:a', 'copy', '-f', 'hash', 'pipe:1']).toString();
      expect(audioHash(final)).toBe(audioHash(src));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
