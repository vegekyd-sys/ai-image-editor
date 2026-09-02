// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findFfmpeg, findFfprobe } from '@/lib/ffmpeg-runtime'
import { clearSkillCache, loadBuiltInSkills, parseSkillMd } from '@/lib/skill-registry'
import { clearWorkspaceCache, getSkillManifest, readBuiltInFile } from '@/lib/workspace'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('video-edit Skill replication profile', () => {
  it('uses one discoverable Skill for source edits and measurable replication', async () => {
    clearSkillCache()
    clearWorkspaceCache()
    const raw = read('src/skills/video-edit/SKILL.md')
    const skill = parseSkillMd(raw)
    const manifest = await getSkillManifest()
    const description = skill?.description.replace(/\s+/g, ' ')

    expect(loadBuiltInSkills().has('video-edit')).toBe(true)
    expect(loadBuiltInSkills().has('video-replication')).toBe(false)
    expect(manifest).toContain('**video-edit**')
    expect(manifest).toContain('Edit, transform, or faithfully recreate a supplied video')
    expect(manifest).toContain('source-edit')
    expect(manifest).toContain('replication')
    expect(read('src/lib/prompts/animate.md')).toContain('skills/video-edit/SKILL.md')
    expect(read('src/lib/prompts/animate.md')).toContain('choose its `replication` profile')
    expect(read('src/lib/prompts/agent.md')).toContain('Before any `generate_animation` request')
    expect(read('src/lib/prompts/agent.md')).toContain('`source-edit`')
    expect(read('src/lib/prompts/agent.md')).toContain('`replication`')
    expect(readBuiltInFile('skills/video-edit/references/shot-blueprint.md')?.content).toContain(
      'P0 machine-readable skeleton',
    )
    expect(readBuiltInFile('skills/video-edit/scripts/extract-shot-blueprint.mjs')?.content).toContain(
      'adaptive_scene_plus_black',
    )
    expect(description).toContain("reference video's timing, camera, action, transitions")
    expect(description).toContain('reference-video-studio for loose inspiration')
    expect(skill?.makaron.sourceMediaRequired).toBe(true)
    expect(skill?.makaron.userSelectable).toBe(false)
    expect(skill?.makaron.manifestVisible).toBe(true)
    expect(skill?.makaron.supportLevel).toBe('native')
    expect(skill?.allowedTools).toEqual(expect.arrayContaining([
      'analyze_video',
      'transcribe_audio',
      'run_code',
      'write_code_file',
      'preview_frame',
      'materialize_media',
    ]))
    expect(raw).toContain('skills/video-edit/references/editing-protocol.md')
    expect(raw).toContain('skills/video-edit/references/replication-protocol.md')
    expect(read('src/skills/video-edit/references/replication-protocol.md')).toContain(
      'skills/video-edit/references/similarity-qa.md',
    )
    expect(read('src/skills/video-edit/references/direct-reference-route.md')).toContain(
      'Never call\n`generate_image` merely to increase dimensions',
    )
    expect(read('src/skills/video-edit/references/direct-reference-route.md')).toContain(
      'The Skill is the implementation',
    )
    expect(read('src/skills/video-edit/references/direct-reference-route.md')).toContain(
      'raw-video `preview_frame` once with 4-6 representative',
    )
    expect(read('src/skills/video-edit/references/direct-reference-route.md')).toContain(
      'stop before `generate_animation`',
    )
    expect(read('src/lib/agent-tools.ts')).not.toContain('replication_contract')
    expect(read('src/lib/agent-tools.ts')).not.toContain('compileVideoReplicationPrompt')
    expect(read('src/lib/agent-tools.ts')).toContain(
      "source: 'video-contact-sheet'",
    )
    const directReferenceRoute = read('src/skills/video-edit/references/direct-reference-route.md')
    const agentToolsSource = read('src/lib/agent-tools.ts')
    expect(directReferenceRoute).not.toContain('replication_contract')
    expect(directReferenceRoute).not.toContain('"audio_policy"')
    expect(directReferenceRoute).toContain(
      'describe requested music, ambience, dialogue, voice, and effects naturally',
    )
    expect(directReferenceRoute).toContain('Unless the user explicitly asks for silence')
    expect(directReferenceRoute).toContain('optimize this prompt for brevity')
    expect(directReferenceRoute).toContain('sole temporal performance, edit, composition, and camera authority')
    expect(directReferenceRoute).toContain('reference-sheet/contact-sheet leakage')
    expect(directReferenceRoute).toContain('Exact temporal fidelity has higher')
    expect(agentToolsSource).not.toContain('replication_contract')
    expect(read('src/skills/reference-video-studio/SKILL.md')).toContain(
      'Use the video-edit replication profile',
    )
  })

  it('extracts a provisional Blueprint that matches the committed P0 schema skeleton', async () => {
    const work = mkdtempSync(join(tmpdir(), 'makaron-video-replication-test-'))
    const output = join(work, 'shot-blueprint.json')
    try {
      const [ffmpegPath, ffprobePath] = await Promise.all([findFfmpeg(), findFfprobe()])
      execFileSync(process.execPath, [
        join(root, 'src/skills/video-edit/scripts/extract-shot-blueprint.mjs'),
        join(root, 'makaron-intro/renders/makaron-intro_2026-05-07_02-05-55.mp4'),
        '--output', output,
        '--ffmpeg', ffmpegPath,
        '--ffprobe', ffprobePath,
      ], { encoding: 'utf8', timeout: 20_000 })

      const blueprint = JSON.parse(readFileSync(output, 'utf8'))
      const schema = JSON.parse(read('src/skills/video-edit/references/shot-blueprint.schema.json'))

      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(Object.keys(blueprint)).toEqual(expect.arrayContaining(schema.required))
      expect(blueprint.reference).toMatchObject({
        duration_sec: 15,
        width: 1080,
        height: 1920,
        fps: 30,
        video_codec: 'h264',
      })
      expect(blueprint.shots).toHaveLength(3)
      expect(blueprint.boundaries[0].time_sec).toBeGreaterThan(4.5)
      expect(blueprint.boundaries[0].time_sec).toBeLessThan(5.5)
      expect(blueprint.boundaries[1].time_sec).toBeGreaterThan(10)
      expect(blueprint.boundaries[1].time_sec).toBeLessThan(11)
      expect(blueprint.analysis.unresolved_boundary_candidates.length).toBeGreaterThan(0)
      expect(blueprint.shots.every((shot: { needs_model_review: boolean }) => shot.needs_model_review)).toBe(true)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps sub-1.5-second cut candidates separate instead of chain-clustering them', async () => {
    const work = mkdtempSync(join(tmpdir(), 'makaron-video-replication-fast-cuts-'))
    const source = join(work, 'fast-cuts.mp4')
    const output = join(work, 'shot-blueprint.json')
    try {
      const [ffmpegPath, ffprobePath] = await Promise.all([findFfmpeg(), findFfprobe()])
      execFileSync(ffmpegPath, [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=0.4',
        '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=0.4',
        '-f', 'lavfi', '-i', 'color=green:s=160x90:r=30:d=0.4',
        '-f', 'lavfi', '-i', 'color=yellow:s=160x90:r=30:d=0.4',
        '-f', 'lavfi', '-i', 'color=magenta:s=160x90:r=30:d=0.4',
        '-f', 'lavfi', '-i', 'color=cyan:s=160x90:r=30:d=0.4',
        '-filter_complex', '[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1:a=0[outv]',
        '-map', '[outv]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source,
      ], { timeout: 20_000 })
      execFileSync(process.execPath, [
        join(root, 'src/skills/video-edit/scripts/extract-shot-blueprint.mjs'),
        source,
        '--output', output,
        '--ffmpeg', ffmpegPath,
        '--ffprobe', ffprobePath,
      ], { encoding: 'utf8', timeout: 20_000 })

      const blueprint = JSON.parse(readFileSync(output, 'utf8'))
      const cutTimes = blueprint.boundaries
        .filter((boundary: { kind: string }) => boundary.kind === 'cut')
        .map((boundary: { time_sec: number }) => boundary.time_sec)

      expect(cutTimes).toEqual([0.8, 1.2, 1.6])
      expect(blueprint.shots).toHaveLength(4)
      expect(Math.max(...cutTimes.slice(1).map((time: number, index: number) => time - cutTimes[index]))).toBeLessThan(1.5)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }, 30_000)
})
