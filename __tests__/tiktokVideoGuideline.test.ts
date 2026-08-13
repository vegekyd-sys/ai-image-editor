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

    // A wide upper title is valid because the right rail starts lower down.
    expect(platformRectFitsSafeRegion(
      { x: 80, y: 200, width: 560, height: 100 },
      TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION,
    )).toBe(true);
    // The same right edge collides once content enters the lower-right rail.
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
    // Lower-right is still usable because the metadata block is left-only.
    expect(platformRectFitsSafeRegion(
      { x: 580, y: 1080, width: 100, height: 100 },
      TIKTOK_ORGANIC_LTR_SAFE_REGION,
    )).toBe(true);
  });

  it('routes every TikTok Remotion composition through the shared guideline gate', () => {
    const director = read('src/skills/_shared/remotion-director-contract.md');
    const compositionPrompt = read('src/lib/prompts/remotion-composition.md');

    expect(director).toContain('skills/tiktok-video/SKILL.md');
    expect(director).toContain('must pass exclusion-zone collision review');
    expect(compositionPrompt).toContain('never as the two characters');
    expect(compositionPrompt).toContain('inside a `<Sequence>` is already local');
    expect(compositionPrompt).toContain('exactly one visible text host');
    expect(read('src/skills/tiktok-video/SKILL.md')).toContain('midpoint from every scene');
    expect(read('src/skills/tiktok-video/SKILL.md')).toContain('no single universal safe rect');
  });

  it('defines native caption, pacing, and packaging grammar beyond safe zones', () => {
    const source = read('src/skills/tiktok-video/SKILL.md');

    expect(source).toContain('## TikTok-Native Creative Grammar');
    expect(source).toContain('make the first `3–6s` the');
    expect(source).toContain('one coherent spoken thought at a time');
    expect(source).toContain('start around `64–84px`');
    expect(source).toContain("speaker's meaning and\n   delivery determine when the caption turns over");
    expect(source).not.toContain('normally `2–7` spoken words');
    expect(source).not.toContain('every `0.5–1.4s`');
    expect(source).toContain('`1.06–1.14×`');
    expect(source).toContain('exactly one visible caption host');
    expect(source).toContain('No persistent full-width lower-third bar');
    expect(source).toContain('For a `20s` English voiceover');
    expect(source).toContain('native-feel pass in addition to collision checks');
  });

  it('keeps caption art direction autonomous while grounding phrase timing in final VO words', () => {
    const source = read('src/skills/tiktok-video/SKILL.md');

    expect(source).toContain('art-direction vocabulary, not a fixed');
    expect(source).toContain('The Agent owns the final font family');
    expect(source).toContain('### Meaning-First, VO-Grounded Phrase Captions');
    expect(source).toContain('Lock the final VO master first');
    expect(source).toContain('utterance and word timestamps');
    expect(source).toContain('understand the complete utterance as speech');
    expect(source).toContain('Semantic and prosodic coherence outrank brevity');
    expect(source).toContain('Word count and cue\n   duration are not targets or quotas');
    expect(source).toContain('illustrations of editorial judgment, not templates or parser rules');
    expect(source).toContain('read the proposed cue sequence aloud');
    expect(source).toContain('look at every cue in isolation');
    expect(source).toContain('probably serves the layout rather than\n   the speaker');
    expect(source).toContain('not a\n   requirement that every cue be a formal written sentence');
    expect(source).toContain('Record the chosen cue\n   text and word range in the Composition Plan');
    expect(source).toContain("start at the first\n   included word's measured start");
    expect(source).toContain("last included word's measured\n   end");
    expect(source).toContain("that word's measured start");
    expect(source).toContain('Never reuse stale timestamps from a draft VO');
    expect(source).toContain('`subtitleSyncEvidence`');
    expect(source).toContain('timingSource: "transcribe_audio"');
    expect(source).toContain('existing `transcribe_audio` word data rather than eyeballing');
    expect(source).toContain('preserve\n  unmistakable visible word gaps');
    expect(source).toContain('explicit `columnGap`');
    expect(source).toContain('non-breaking-space spacer spans');
    expect(source).toContain("scaled word's extra width");
    expect(source).toContain('prefer color/weight emphasis without scale');
    expect(source).toContain('do not alter correct VO timestamps to repair a typography problem');
  });
});
