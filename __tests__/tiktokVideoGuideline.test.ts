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
});
