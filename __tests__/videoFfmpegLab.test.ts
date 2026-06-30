import { describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { MAX_ACCEPTED_DURATION, MAX_DURATION } from '@/lib/video-upload'
import { findFfmpeg } from '@/lib/ffmpeg-runtime'
import { buildMediaItems, runNodeMediaCode } from '@/lib/media-sandbox'

const exec = promisify(execFile)

describe('Agent FFmpeg video lab', () => {
  it('allows long uploads for Agent-side FFmpeg workflows', () => {
    expect(MAX_DURATION).toBeGreaterThanOrEqual(120)
    expect(MAX_ACCEPTED_DURATION).toBeGreaterThan(38.776)
  })

  it('keeps Makaron CLI upload and provider video limits separate', () => {
    const cli = readFileSync(join(process.cwd(), 'packages/makaron-cli/bin/makaron.mjs'), 'utf8')
    const readme = readFileSync(join(process.cwd(), 'packages/makaron-cli/README.md'), 'utf8')
    const skill = readFileSync(join(process.cwd(), 'packages/makaron-cli/skills/makaron/SKILL.md'), 'utf8')

    expect(cli).toContain('const MAX_VIDEO_UPLOAD_DURATION = 120')
    expect(cli).toContain('const MAX_VIDEO_UPLOAD_FILE_SIZE_MB = 50')
    expect(cli).toContain('const MAX_VIDEO_PROVIDER_REFERENCE_DURATION = 15')
    expect(cli).toContain('maxDuration: MAX_VIDEO_PROVIDER_REFERENCE_DURATION')
    expect(cli).toContain('Math.min(MAX_VIDEO_PROVIDER_REFERENCE_DURATION')
    expect(cli).not.toContain('const MAX_VIDEO_DURATION = 15')
    expect(readme).toContain('max 50MB, max 120s')
    expect(skill).toContain('max 50MB, max 120s')
    expect(readme).toContain('frame pixels 409,600-2,086,876')
    expect(skill).toContain('frame pixels 409,600-2,086,876')
    expect(readme).not.toContain('max 200MB, max 120s')
    expect(skill).not.toContain('max 200MB, max 120s')
  })

  it('publishes direct FFmpeg MP4 deliverables to the timeline by default', () => {
    const skill = readFileSync(join(process.cwd(), 'src/skills/video-ffmpeg-lab/SKILL.md'), 'utf8')
    const agent = readFileSync(join(process.cwd(), 'src/lib/agent.ts'), 'utf8')

    expect(skill).toContain('if FFmpeg produces user-facing MP4 deliverables, publish them to the timeline immediately')
    expect(skill).toContain('Direct user-facing split/trim/export requests are different: publish those MP4 deliverables to the timeline')
    expect(agent).toContain('If these are user-facing MP4 deliverables, immediately publish them with write_file({ fromWorkspaceOutputs: true, mediaType: "video"')
    expect(agent).not.toContain('For direct split/trim/export requests, `type: "files"` is the final answer')
    expect(agent).not.toContain('do not call write_file for type:"files" outputs')
  })

  it('keeps run_code workspace outputs index-backed and publishable by explicit path', () => {
    const agent = readFileSync(join(process.cwd(), 'src/lib/agent.ts'), 'utf8')

    expect(agent).toContain('async function ensureWorkspaceFileIndex')
    expect(agent).toContain('await ensureWorkspaceFileIndex(ctx, output)')
    expect(agent).toContain('async function recoverWorkspaceMediaPath')
    expect(agent).toContain('const storagePath = `${ctx.userId}/workspace/${filePath}`')
    expect(agent).toContain('No publishable workspace ${typeLabel} outputs found for requested path(s)')
  })

  it('cleans invalid workspace output durations from published timeline titles', () => {
    const agent = readFileSync(join(process.cwd(), 'src/lib/agent.ts'), 'utf8')

    expect(agent).toContain('function outputDisplayName')
    expect(agent).toContain('(?:undefined|null|NaN)s?')
    expect(agent).toContain('if (cleaned) return cleaned')
  })

  it('resolves video snapshots to the real mp4 URL, not the poster image', async () => {
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [{
                image_url: 'https://example.com/poster.jpg',
                description: 'uploaded video',
                type: 'video',
                video_meta: {
                  videoUrl: 'https://example.com/video.mp4',
                  duration: 38.776,
                  width: 720,
                  height: 1280,
                  status: 'completed',
                },
              }],
            }),
          }),
        }),
      }),
    }

    const media = await buildMediaItems({
      snapshotImages: ['https://example.com/poster.jpg'],
      projectId: 'project-1',
      supabase: fakeSupabase,
    })

    expect(media[0]).toMatchObject({
      kind: 'video',
      url: 'https://example.com/video.mp4',
      posterUrl: 'https://example.com/poster.jpg',
      duration: 38.776,
      width: 720,
      height: 1280,
    })
  })

  it('runs open Node FFmpeg code and probes the generated MP4', async () => {
    const code = `
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const path = require('path');
      const exec = promisify(execFile);
      const out = path.join(outputDir, 'smoke.mp4');
      await exec(ffmpegPath, [
        '-f', 'lavfi',
        '-i', 'color=c=black:s=160x120:r=30',
        '-t', '1',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        out,
      ]);
      return { type: 'video', path: out, contentType: 'video/mp4', description: 'smoke' };
    `

    const result = await runNodeMediaCode({
      code,
      mediaItems: [],
      projectId: 'test-project',
      userId: 'test-user',
      timeoutMs: 10_000,
    })

    expect(result.type).toBe('video')
    expect(result.primaryOutput?.contentType).toBe('video/mp4')
    expect(result.primaryOutput?.duration).toBeCloseTo(1, 1)
    expect(result.primaryOutput?.width).toBe(160)
    expect(result.primaryOutput?.height).toBe(120)
    expect(result.primaryOutput?.probe).toBeTruthy()
  }, 20_000)

  it('cuts ten video inputs into one workspace MP4 without losing the output index', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'makaron-10-video-'))
    const ffmpegPath = await findFfmpeg()
    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'orange', 'pink', 'white', 'gray']
    const mediaItems = []
    const uploads: Array<{ path: string; size: number; contentType?: string }> = []
    const rows: Array<Record<string, unknown>> = []
    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: async (storagePath: string, body: Buffer | string, options: { contentType?: string }) => {
            uploads.push({
              path: storagePath,
              size: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body),
              contentType: options.contentType,
            })
            return { error: null }
          },
          getPublicUrl: (storagePath: string) => ({
            data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/images/${storagePath}` },
          }),
        }),
      },
      from: () => ({
        upsert: async (row: Record<string, unknown>) => {
          rows.push(row)
          return { error: null }
        },
      }),
    }

    try {
      for (let index = 0; index < 10; index += 1) {
        const filePath = join(tempDir, `source-${String(index + 1).padStart(2, '0')}.mp4`)
        await exec(ffmpegPath, [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=${colors[index]}:s=160x90:r=24:d=0.8`,
          '-f', 'lavfi',
          '-i', `sine=frequency=${440 + index * 35}:duration=0.8`,
          '-shortest',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          filePath,
        ])
        const base64 = (await readFile(filePath)).toString('base64')
        mediaItems.push({
          index: index + 1,
          kind: 'video' as const,
          url: `data:video/mp4;base64,${base64}`,
          duration: 0.8,
          width: 160,
          height: 90,
        })
      }

      const code = `
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const fs = require('fs');
        const path = require('path');
        const exec = promisify(execFile);
        const clips = [];

        for (const [index, input] of inputFiles.entries()) {
          const out = path.join(outputDir, \`clip-\${String(index + 1).padStart(2, '0')}.mp4\`);
          await exec(ffmpegPath, [
            '-ss', '0.05',
            '-i', input.inputPath,
            '-t', '0.45',
            '-vf', 'scale=160:90,setsar=1',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            out,
          ]);
          clips.push(out);
        }

        const concatList = path.join(outputDir, 'concat.txt');
        fs.writeFileSync(concatList, clips.map(file => "file '" + file.replace(/'/g, "'\\\\''") + "'").join('\\n'));
        const finalVideo = path.join(outputDir, 'ten-video-story-cut.mp4');
        await exec(ffmpegPath, [
          '-f', 'concat',
          '-safe', '0',
          '-i', concatList,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          finalVideo,
        ]);

        return {
          type: 'files',
          outputs: [{
            path: finalVideo,
            contentType: 'video/mp4',
            description: '10-video-local-stress-cut',
          }],
        };
      `

      const result = await runNodeMediaCode({
        code,
        mediaRefs: Array.from({ length: 10 }, (_, i) => i + 1),
        mediaItems,
        projectId: 'test-project',
        userId: 'test-user',
        supabase: fakeSupabase,
        timeoutMs: 120_000,
      })

      expect(result.type).toBe('files')
      expect(result.outputs).toHaveLength(1)
      expect(result.primaryOutput?.contentType).toBe('video/mp4')
      expect(result.primaryOutput?.workspacePath).toMatch(/^test-project\/media\/.+ten-video-story-cut\.mp4$/)
      expect(result.primaryOutput?.storageUrl).toContain('/test-user/workspace/test-project/media/')
      expect(result.primaryOutput?.duration).toBeGreaterThan(4)
      expect(result.primaryOutput?.duration).toBeLessThan(5.2)
      expect(result.primaryOutput?.width).toBe(160)
      expect(result.primaryOutput?.height).toBe(90)
      expect(uploads).toHaveLength(1)
      expect(uploads[0]).toMatchObject({ contentType: 'video/mp4' })
      expect(uploads[0].size).toBeGreaterThan(1_000)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        user_id: 'test-user',
        path: result.primaryOutput?.workspacePath,
        content_type: 'video/mp4',
        storage_url: result.primaryOutput?.storageUrl,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }, 150_000)

  it('supports reusable FFmpeg editing primitives', async () => {
    const code = `
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const path = require('path');
      const exec = promisify(execFile);

      const input = path.join(outputDir, 'source.mp4');
      await exec(ffmpegPath, [
        '-f', 'lavfi',
        '-i', 'testsrc2=duration=4:size=320x180:rate=30',
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        '-movflags', '+faststart',
        input,
      ]);

      const info = await probeVideo(input);
      const half = (info.duration || 4) / 2;
      const outputs = [];

      const trimmed = path.join(outputDir, 'trimmed.mp4');
      await exec(ffmpegPath, [
        '-ss', '0.5',
        '-i', input,
        '-t', '1.25',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        trimmed,
      ]);
      outputs.push({ path: trimmed, contentType: 'video/mp4', description: 'trim first beat' });

      for (const [index, start] of [0, half].entries()) {
        const out = path.join(outputDir, \`part-\${String(index + 1).padStart(2, '0')}.mp4\`);
        await exec(ffmpegPath, [
          '-ss', String(start),
          '-i', input,
          '-t', String(half),
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          out,
        ]);
        outputs.push({
          path: out,
          contentType: 'video/mp4',
          description: \`Split part \${index + 1}\`,
        });
      }

      const concatList = path.join(outputDir, 'concat.txt');
      const fs = require('fs');
      fs.writeFileSync(concatList, [
        "file '" + outputs[1].path.replace(/'/g, "'\\\\''") + "'",
        "file '" + outputs[2].path.replace(/'/g, "'\\\\''") + "'",
      ].join('\\n'));
      const stitched = path.join(outputDir, 'stitched.mp4');
      await exec(ffmpegPath, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatList,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        stitched,
      ]);
      outputs.push({ path: stitched, contentType: 'video/mp4', description: 'concat split parts' });

      const square = path.join(outputDir, 'square-muted.mp4');
      await exec(ffmpegPath, [
        '-i', input,
        '-vf', 'crop=180:180:70:0,scale=240:240',
        '-an',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        square,
      ]);
      outputs.push({ path: square, contentType: 'video/mp4', description: 'crop scale mute' });

      const frame = path.join(outputDir, 'frame-001.jpg');
      await exec(ffmpegPath, [
        '-ss', '1',
        '-i', input,
        '-frames:v', '1',
        '-q:v', '3',
        frame,
      ]);
      outputs.push({ path: frame, contentType: 'image/jpeg', description: 'analysis frame' });

      return { type: 'files', outputs };
    `

    const result = await runNodeMediaCode({
      code,
      mediaItems: [],
      projectId: 'test-project',
      userId: 'test-user',
      timeoutMs: 60_000,
    })

    expect(result.type).toBe('files')
    expect(result.outputs).toHaveLength(6)

    const [trimmed, part1, part2, stitched, squareMuted, frame] = result.outputs
    expect(trimmed.duration).toBeCloseTo(1.25, 1)
    expect(part1.duration).toBeCloseTo(2, 1)
    expect(part2.duration).toBeCloseTo(2, 1)
    expect(stitched.duration).toBeGreaterThan(3.8)
    expect(stitched.duration).toBeLessThan(4.3)
    expect(squareMuted.width).toBe(240)
    expect(squareMuted.height).toBe(240)
    expect(squareMuted.probe?.audioCodec).toBeUndefined()
    expect(frame.contentType).toBe('image/jpeg')
    expect(result.outputs.slice(0, 5).every(output => output.probe)).toBe(true)
  }, 80_000)
})
