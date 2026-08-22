import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
  TIKTOK_ORGANIC_LTR_SAFE_REGION,
  platformRectFitsSafeRegion,
  scalePlatformSafeRegion,
} from '@/lib/platform-safe-zones';
import { parseSkillMd } from '@/lib/skill-registry';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('TikTok video guideline', () => {
  it('exposes a selectable 9:16 built-in Skill', () => {
    const source = read('src/skills/tiktok-video/SKILL.md');
    const skill = parseSkillMd(source);

    expect(skill?.name).toBe('tiktok-video');
    expect(skill?.makaron.builtIn).toBe(true);
    expect(skill?.makaron.defaultAspectRatio).toBe('9:16');
    expect(skill?.makaron.userSelectable).not.toBe(false);
  });

  it('preserves the official non-rectangular Auction In-Feed region', () => {
    expect(scalePlatformSafeRegion(
      TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
      1080,
      1920,
    )).toEqual({
      contentBounds: { x: 120, y: 240, width: 840, height: 1020 },
      exclusions: [{
        id: 'right-interaction-rail',
        label: 'Avatar, like, comment, save, and share controls',
        rect: { x: 780, y: 840, width: 180, height: 420 },
      }],
    });

    expect(platformRectFitsSafeRegion(
      { x: 80, y: 200, width: 560, height: 100 },
      TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
    )).toBe(true);
    expect(platformRectFitsSafeRegion(
      { x: 80, y: 600, width: 560, height: 100 },
      TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
    )).toBe(false);
    expect(platformRectFitsSafeRegion(
      { x: 80, y: 600, width: 440, height: 100 },
      TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
    )).toBe(true);
  });

  it('uses the full organic canvas minus three independent UI holes', () => {
    expect(scalePlatformSafeRegion(
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
      1080,
      1920,
    )).toEqual({
      contentBounds: { x: 0, y: 0, width: 1080, height: 1920 },
      exclusions: [
        {
          id: 'top-app-chrome',
          label: 'Top navigation and status controls',
          rect: { x: 0, y: 0, width: 1080, height: 120 },
        },
        {
          id: 'right-interaction-rail',
          label: 'Avatar, like, comment, save, and share controls',
          rect: { x: 900, y: 600, width: 180, height: 960 },
        },
        {
          id: 'bottom-left-post-metadata',
          label: 'Account name, short post caption, translation labels, and music line',
          rect: { x: 0, y: 1650, width: 840, height: 270 },
        },
      ],
    });
    expect(platformRectFitsSafeRegion(
      { x: 24, y: 100, width: 672, height: 100 },
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
    )).toBe(true);
    expect(platformRectFitsSafeRegion(
      { x: 610, y: 500, width: 60, height: 100 },
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
    )).toBe(false);
    expect(platformRectFitsSafeRegion(
      { x: 80, y: 1120, width: 400, height: 100 },
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
    )).toBe(false);
    expect(platformRectFitsSafeRegion(
      { x: 580, y: 1080, width: 100, height: 100 },
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
    )).toBe(true);
  });

  it('routes TikTok compositions through focused conditional references', () => {
    const director = read('src/skills/_shared/remotion-director-contract.md');
    const compositionPrompt = read('src/lib/prompts/remotion-composition.md');
    const skill = read('src/skills/tiktok-video/SKILL.md');

    expect(director).toContain('skills/tiktok-video/SKILL.md');
    expect(director).toContain('must pass exclusion-zone collision review');
    expect(compositionPrompt).toContain('exactly one visible text host');
    expect(skill).toContain('references/platform-layout.md');
    expect(skill).toContain('references/caption-direction.md');
    expect(skill).toContain('references/audio-sync.md');
    expect(skill).toContain('references/delivery-qa.md');
  });

  it('keeps the entrypoint focused on autonomous direction, not a caption template', () => {
    const source = read('src/skills/tiktok-video/SKILL.md');

    expect(source).toContain('invitation to direct');
    expect(source).toContain('defaults to muted clip audio');
    expect(source).toContain('does\n  not require wall-to-wall narration');
    expect(source).toContain('full\nsentences covering nearly every scene is an over-written cut');
    expect(source).toContain('There is no default font family, black subtitle rectangle, left vertical');
    expect(source).toContain('Bold condensed all-caps is one possible voice, not a synonym for TikTok');
    expect(source).toContain('not the easiest reusable implementation');
    expect(source).toContain('boolean that recolors the whole sentence does not count');
    expect(source).toContain('missing `drawtext` filter is not permission to downgrade');
    expect(source).toContain('generic ASS subtitles');
    expect(source).not.toContain('normally `2–7` spoken words');
    expect(source).not.toContain('every `0.5–1.4s`');
    expect(source.split('\n').length).toBeLessThan(190);
  });

  it('grounds speech timing without owning the caption appearance', () => {
    const source = read('src/skills/tiktok-video/references/caption-direction.md');
    const compositionPrompt = read('src/lib/prompts/remotion-composition.md');

    expect(source).toContain('Lock the final narration-containing audio master');
    expect(source).toContain('Semantic and prosodic coherence outrank brevity');
    expect(source).toContain('Read the cue sequence aloud');
    expect(source).toContain('`subtitleSyncEvidence`');
    expect(source).toContain('Narration with an empty evidence array is a failure');
    expect(source).toContain('timingSource: "transcribe_audio"');
    expect(source).toContain('explicit `columnGap`');
    expect(source).toContain('must not rely on `white-space: nowrap`');
    expect(source).toContain('Typography remains Composition-owned');
    expect(source).toContain('There is no required font, black plaque');
    expect(compositionPrompt).toContain('Multi-line subtitles must also be collision-free');
    expect(compositionPrompt).toContain('Long single-line subtitles must fit completely');
    expect(compositionPrompt).toContain("Do not use `whiteSpace: 'nowrap'`");
    expect(compositionPrompt).toContain('normalizes escaped newlines at renderer input and DOM text leaves');
    expect(compositionPrompt).toContain('every non-empty `subtitleSyncEvidence` cue must');
  });

  it('defaults to one muted-source VO plus BGM master and one measured clock', () => {
    const skill = read('src/skills/tiktok-video/SKILL.md');
    const audio = read('src/skills/tiktok-video/references/audio-sync.md');
    const compositionPrompt = read('src/lib/prompts/remotion-composition.md');
    const director = read('src/skills/_shared/remotion-director-contract.md');

    expect(skill).toContain('containing VO and instrumental BGM');
    expect(skill).toContain('mute their embedded\n  audio');
    expect(skill).toContain('rather than trusting only the aggregate pass flag');
    expect(audio).toContain('`generate_audio({ kind: "mixed", ... })` once');
    expect(audio).toContain('never keep more than one accepted master');
    expect(audio).toContain('intentional BGM-only tail');
    expect(audio).toContain('not only the aggregate `verification.passed`');
    expect(audio).toContain('drops its final meaningful word');
    expect(audio).toContain("that cue's actual\n  transcript");
    expect(audio).toContain('every narrated\n   Script section in `expected_sections`');
    expect(audio).toContain('`volume={0}`');
    expect(audio).toContain('the only speech clock');
    expect(audio).toContain('derive those ranges from it');
    expect(audio).toContain('do not copy its\n   numbers into a second hand-authored caption');
    expect(audio).toContain('treat\non-screen copy as editorial beat text rather than speech subtitles');
    expect(audio).toContain('retry it once on the same\n   accepted master');
    expect(audio).toContain('stop before narrated Storyboard, Composition');
    expect(audio).toContain('It is not a fallback clock for a\ngenerated mixed master');
    expect(audio).toContain('visible phrase and emphasized keyword');
    expect(compositionPrompt).toContain('one generated mixed VO+BGM');
    expect(compositionPrompt).toContain('planned Script timing or BGM rhythm cannot replace measured speech timing');
    expect(director).toContain('one mixed VO+BGM soundtrack');
  });

  it('requires final MP4 acceptance separately from Preview', () => {
    const source = read('src/skills/tiktok-video/references/delivery-qa.md');
    const compositionPrompt = read('src/lib/prompts/remotion-composition.md');

    expect(source).toContain("Settled-font Preview is the Agent's composition gate");
    expect(source).toContain('Ordinary Studio export completes asynchronously');
    expect(source).toContain('Do not claim the Agent inspected an MP4');
    expect(source).toContain('The MP4\n   is authoritative for glyph metrics');
    expect(source).toContain('A clean Preview cannot waive an export-only overlap');
    expect(source).toContain('stable midpoint from every scene and every spoken-caption');
    expect(source).toContain('longest single-line cue');
    expect(source).toContain('frame half a second before');
    expect(source).toContain('unfinished closing phrase');
    expect(source).toContain('Decode the complete video stream');
    expect(source).toContain('render\n   job reporting success is not delivery acceptance');
    expect(source).toContain('generic ASS/`drawtext` burn-in');
    expect(source).toContain('generated narration master with failed or unavailable ASR blocks this gate');
    expect(source).toContain('second\n   manually retyped subtitle schedule is a synchronization failure');
    expect(compositionPrompt).toContain('extract every spoken cue midpoint');
    expect(compositionPrompt).toContain('Closing copy, CTA, or a final reveal');
    expect(compositionPrompt).toContain('render success is not typography\n  acceptance');
  });
});
