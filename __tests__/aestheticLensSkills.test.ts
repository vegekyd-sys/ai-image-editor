import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSkillMd } from '../src/lib/skill-registry';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const variants = [
  'explainer-aesthetic-rampstack',
  'explainer-aesthetic-lottiefiles',
  'explainer-aesthetic-disney',
];

describe('aesthetic lens benchmark skills', () => {
  it('keeps each variant on the same explainer harness', () => {
    const baseline = parseSkillMd(read('src/skills/explainer-video/SKILL.md'))!;
    for (const name of variants) {
      const raw = read(`src/skills/${name}/SKILL.md`);
      const skill = parseSkillMd(raw)!;
      expect(skill.makaron.studioRunRecipe).toBe('explainer-video');
      expect(skill.makaron.studioRunProfile).toBe('generated-explainer');
      expect(skill.makaron.canonicalSkill).toBe('explainer-video');
      expect([...skill.allowedTools!].sort()).toEqual([...baseline.allowedTools!].sort());
      expect(raw).toContain('skills/explainer-video/SKILL.md');
      expect(raw).toContain('skills/_shared/aesthetic-lens-contract.md');
      expect(raw).toContain('only replacement for aesthetic direction');
    }
  });

  it('locks non-aesthetic variables and human-led evaluation', () => {
    const contract = read('src/skills/_shared/aesthetic-lens-contract.md');
    const benchmark = read('docs/aesthetic-skill-benchmark.md');
    expect(contract).toContain('user prompt and reference media');
    expect(contract).toContain('factual claims, narration, scene purposes');
    expect(contract).toContain('voiceover/subtitle/audio requirements');
    expect(contract).toContain('unlimited aggregate source');
    expect(contract).toContain('Human A/B preference');
    expect(benchmark).toContain('30 seconds');
    expect(benchmark).toContain('no more than three generated');
    expect(benchmark).toContain('no provider-generated video inserts');
    expect(benchmark).toContain('first Composition autosave');
  });

  it('vendors only native, attributed, runtime-compatible lenses', () => {
    const lensFiles = [
      'aesthetic-rampstack-direction',
      'aesthetic-lottiefiles-motion',
      'aesthetic-disney-character-motion',
    ];
    for (const name of lensFiles) {
      const raw = read(`src/skills/${name}/SKILL.md`);
      const skill = parseSkillMd(raw)!;
      expect(skill.makaron.sourceProject).toMatch(/^github:/);
      expect(skill.makaron.supportLevel).toBe('adapted');
      expect(skill.makaron.adapterFamily).toBe('aesthetic');
      expect(skill.makaron.tags).toContain('mit');
      expect(raw).not.toMatch(/HyperFrames|gsap\.|framer-motion/i);
    }
  });
});
