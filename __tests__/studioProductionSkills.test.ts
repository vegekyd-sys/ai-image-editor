import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseSkillMd } from '@/lib/skill-registry';

const root = path.resolve(__dirname, '..');

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const recipes = [
  { name: 'reference-video-studio', profile: 'reference-led', sourceRequired: true },
  { name: 'cinematic-video', profile: 'generated-or-hybrid', sourceRequired: false },
  { name: 'motion-design-video', profile: 'local-animation', sourceRequired: false },
  { name: 'source-video-studio', profile: 'source-led', sourceRequired: true },
  { name: 'content-repurpose', profile: 'batch-source-led', sourceRequired: true },
  { name: 'screen-demo', profile: 'capture-or-synthetic', sourceRequired: false },
  { name: 'localization-dub', profile: 'source-led-variant', sourceRequired: true },
  { name: 'character-animation', profile: 'local-character-animation', sourceRequired: false },
  { name: 'avatar-spokesperson', profile: 'generated-presenter', sourceRequired: false },
  { name: 'music-to-video', profile: 'audio-led-local-animation', sourceRequired: false },
  { name: 'website-to-video', profile: 'site-led-remotion', sourceRequired: false },
] as const;

describe('Studio production skills', () => {
  it.each(recipes)('$name exposes a machine-readable Studio Run recipe', ({ name, profile, sourceRequired }) => {
    const raw = read(`src/skills/${name}/SKILL.md`);
    const skill = parseSkillMd(raw);

    expect(skill?.name).toBe(name);
    expect(skill?.makaron.builtIn).toBe(true);
    expect(skill?.makaron.studioRunRecipe).toBe(name);
    expect(skill?.makaron.studioRunProfile).toBe(profile);
    expect(skill?.makaron.sourceMediaRequired).toBe(sourceRequired);
    expect(skill?.makaron.tags).toEqual(expect.arrayContaining(['video', 'workflow', 'studio-run', 'remotion']));
    expect(skill?.allowedTools).toEqual(expect.arrayContaining([
      'read_file',
      'studio_run',
      'run_code',
      'write_file',
      'preview_frame',
      'materialize_media',
    ]));
    expect(raw).toContain('skills/_shared/studio-production/production-contract.md');
    expect(raw).toContain(`recipe \`${name}\``);
  });

  it('keeps production intelligence in shared director contracts', () => {
    const production = read('src/skills/_shared/studio-production/production-contract.md');
    const reference = read('src/skills/_shared/studio-production/reference-analysis.md');
    const creative = read('src/skills/creative-direction/SKILL.md');
    const audio = read('src/skills/_shared/studio-production/audio-direction.md');
    const review = read('src/skills/_shared/studio-production/review-contract.md');

    expect(production).toContain('stages remain stable');
    expect(production).toContain('not callable Makaron tools');
    expect(reference).toContain('five dimensions');
    expect(reference).toContain('Separate `keep` from `change`');
    expect(production).toContain('skills/creative-direction/SKILL.md');
    expect(creative).toContain('Inspiration Pass');
    expect(creative).toContain('creativeTreatment');
    expect(creative).toContain('A/B Review');
    expect(creative).toContain('6500 source');
    expect(audio).toContain('Treat audio as part of the edit');
    expect(review).toContain('Materialize the MP4');
    expect(review).toContain('Slideshow risk');
  });

  it('exposes built-in Studio Run metadata to the CLI API', () => {
    const route = read('src/app/api/skills/route.ts');
    const cli = read('packages/makaron-cli/bin/makaron.mjs');

    expect(route).toContain('studioRunRecipe: s.makaron?.studioRunRecipe');
    expect(route).toContain('sourceMediaRequired: s.makaron?.sourceMediaRequired || false');
    expect(cli).toContain("args.includes('--built-in')");
    expect(cli).toContain("case 'studio_recipe'");
    expect(cli).toContain("case 'studio_run'");
  });
});
