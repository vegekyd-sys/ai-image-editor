// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRetake, validateRetakeRange, retakePrompt, resolveRetakeModel } from '@/lib/video-retake-contract';
import { assembleRetake, extractRetakeContext, extractRetakeBoundaryFrames, extractRetakeInspectionFrames, inspectRetakeSource } from '@/lib/video-retake-media';
import * as ffmpegRuntime from '@/lib/ffmpeg-runtime';
import { findFfmpeg } from '@/lib/ffmpeg-runtime';
import { createRequire } from 'node:module';
import { extractVideoFrame } from '@/lib/video-frame';

describe('Retake interval contract', () => {
  it('uses H3 Max by default and keeps explicitly selected editing models', () => {
    expect(resolveRetakeModel()).toBe('fal-h3-max');
    expect(resolveRetakeModel('auto')).toBe('fal-h3-max');
    expect(resolveRetakeModel('seedance-2.5')).toBe('seedance-2.5');
    expect(resolveRetakeModel('seedance-2.5-eco')).toBe('seedance-2.5-eco');
    expect(planRetake({start:12.3,end:26},30.14,'seedance-2.5-eco')).toMatchObject({contextStart:12.3,contextEnd:26,generationDuration:13.7});
    expect(() => resolveRetakeModel('ltx-2.3-retake')).toThrow(/supports/);
  });
  it('expands reference context without expanding the replacement interval', () => {
    const plan = planRetake({ start: 2, end: 3 }, 10, 'fal-h3-max');
    expect(plan).toMatchObject({ start: 2, end: 3, contextStart: 0, contextEnd: 5, patchOffset: 0, generationDuration: 5, outputMode: 'selection' });
    expect(planRetake({ start: 9, end: 10 }, 10, 'seedance-2.5').contextStart).toBe(6);
  });
  it('rejects invalid and unsupported requests before paid submission', () => {
    for (const range of [{ start: NaN, end: 2 }, { start: -1, end: 2 }, { start: 2, end: 2 }, { start: 0, end: 16 }]) {
      expect(() => validateRetakeRange(range, 20)).toThrow();
    }
    expect(() => planRetake({ start: 0, end: 2 }, 1, 'seedance-2.5')).toThrow();
    expect(() => planRetake({ start: 0, end: 2 }, 10, 'minimax-h3-max')).toThrow(/Turbo/);
  });
  it('passes the inspected Agent instruction unchanged without creative overrides', () => {
    const instruction = '0–1s: continue the visible landing. CUT. 1–2s: wheel close-up. CUT. 2–3s: high angle.';
    expect(retakePrompt(instruction)).toBe(instruction);
    expect(retakePrompt(`  ${instruction}  `)).toBe(instruction);
    expect(() => retakePrompt('  ')).toThrow(/Describe/);
    expect(retakePrompt(instruction)).not.toContain('NEW TAKE');
  });
  it('extracts the first and last selected frames from the original timebase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retake-boundaries-'));
    const ffmpeg = await findFfmpeg();
    try {
      const src = join(dir, 'source.mp4');
      execFileSync(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=red:s=320x240:r=24:d=2',
        '-f','lavfi','-i','color=blue:s=320x240:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=6.2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:a','aac','-c:v','libx264',src]);
      const frames = await extractRetakeBoundaryFrames(readFileSync(src), planRetake({start:2,end:3},6,'fal-h3-max'),24);
      const { default: sharp } = await import('sharp');
      const color = async (buffer: Buffer) => [...(await sharp(buffer).resize(1,1).raw().toBuffer())];
      expect((await color(frames.start))[2]).toBeGreaterThan(200);
      expect((await color(frames.end))[2]).toBeGreaterThan(200);
      const probe = vi.spyOn(ffmpegRuntime, 'probeVideoFile').mockResolvedValue({duration:6.2,width:320,height:240,fps:24,audioCodec:'aac'});
      const bundledFfmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;
      const binary = vi.spyOn(ffmpegRuntime,'findFfmpeg').mockResolvedValue(bundledFfmpeg);
      try {
      expect(await inspectRetakeSource(readFileSync(src))).toMatchObject({frameCount:144});
      const inspection = await extractRetakeInspectionFrames(readFileSync(src), planRetake({start:3.2,end:6.2},6.2,'fal-h3-max'),24);
      expect(inspection.timestamps.at(-1)).toBeLessThan(6);
      const tailBoundary = await extractRetakeBoundaryFrames(readFileSync(src), planRetake({start:3.2,end:6.2},6.2,'fal-h3-max'),24);
      expect((await color(tailBoundary.end))[2]).toBeGreaterThan(200);
      expect(inspection.frames.length).toBeGreaterThan(2);
      expect((await color(inspection.frames.at(-1)!))[2]).toBeGreaterThan(200);
      const fetchMock = vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(readFileSync(src)));
      try { expect((await color(await extractVideoFrame('https://example.com/source.mp4',{timestamp:6.2})))[2]).toBeGreaterThan(200); }
      finally { fetchMock.mockRestore(); }
      } finally { probe.mockRestore(); binary.mockRestore(); }
    } finally { rmSync(dir,{recursive:true,force:true}); }
  },30_000);
  it('retains generated first/last frames when fitting a short selection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retake-endpoints-'));
    const ffmpeg = await findFfmpeg();
    const run = (args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
    try {
      const src = join(dir, 'source.mp4'), patch = join(dir, 'patch.mp4'), final = join(dir, 'final.mp4');
      run(['-f','lavfi','-i','color=black:s=320x240:r=24:d=6','-c:v','libx264',src]);
      run(['-f','lavfi','-i','color=red:s=320x240:r=24:d=0.041667','-f','lavfi','-i','color=green:s=320x240:r=24:d=5',
        '-f','lavfi','-i','color=blue:s=320x240:r=24:d=0.041667','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264',patch]);
      const { writeFileSync } = await import('node:fs');
      const result = await assembleRetake(readFileSync(src),readFileSync(patch),planRetake({start:2,end:3},6));
      writeFileSync(final,result.bytes);
      const pixel = (frame: number) => [...run(['-i',final,'-vf',`select=eq(n\\,${frame}),scale=1:1`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];
      expect(pixel(48)[0]).toBeGreaterThan(200);
      expect(pixel(71)[2]).toBeGreaterThan(200);
      expect(pixel(72).every(v=>v<10)).toBe(true);
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
