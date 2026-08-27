import { describe, expect, it } from 'vitest';
import path from 'path';
import { parseSkillMd } from '@/lib/skill-registry';
import { readAgentAwareSource } from './helpers/agentRuntimeSource';

const root = path.resolve(__dirname, '..');

function read(relativePath: string) {
  return readAgentAwareSource(root, relativePath);
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
      'prepare_visual_asset',
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
    const motion = read('src/skills/motion-design-video/SKILL.md');
    const audio = read('src/skills/_shared/studio-production/audio-direction.md');
    const review = read('src/skills/_shared/studio-production/review-contract.md');
    const taste = read('src/skills/_shared/studio-production/taste-direction.md');
    const agent = read('src/lib/agent.ts');

    expect(production).toContain('stages remain stable');
    expect(production).toContain('not callable Makaron tools');
    expect(reference).toContain('five dimensions');
    expect(reference).toContain('Separate `keep` from `change`');
    expect(motion).toContain('does not mean "no audio"');
    expect(motion).toContain('Visual execution does not replace storytelling');
    expect(production).toContain('fresh project and');
    expect(production).toContain('Record Agent queue-submission');
    expect(production).toContain('skills/_shared/visual-direction/SKILL.md');
    expect(production).toContain('skills/_shared/studio-production/taste-direction.md');
    expect(production).toContain('skills/_shared/visual-asset-bridge/SKILL.md');
    expect(production).toContain('optional `visualPlan`');
    expect(production).toContain('`prepared` field');
    expect(production).not.toContain('creative-direction/SKILL.md');
    expect(audio).toContain('Treat audio as part of the edit');
    expect(audio).toContain('Voice Performance Brief');
    expect(audio).toContain('intentionally\n  isolated narration/VO master');
    expect(audio).toContain('`generate_audio({ kind: "mixed", ... })` exactly once');
    expect(audio).toContain('master clock');
    expect(review).toContain('Call `materialize_media` once');
    expect(review).toContain('Semantic completeness');
    expect(review).toContain('subtitleSyncEvidence');
    expect(review).toContain('Do not author Review or Delivery JSON');
    expect(taste).toContain('Five Questions For A Decisive Visual Beat');
    expect(taste).toContain('Why This Idea For This Subject?');
    expect(taste).toContain('What Changes Because Of What?');
    expect(taste).toContain('Where Is The Second Thought?');
    expect(taste).toContain('Will The Viewer Read It Without An Explanation?');
    expect(taste).toContain('Can This Medium Make The Idea Convincing?');
    expect(taste).toContain('Three Questions For The Whole Film');
    expect(taste).not.toContain('an image may become a surface, portal, mask, texture');
    expect(taste).toContain("private director's");
    expect(taste).toContain('self-dialogue, not a style recipe');
    expect(taste).toContain('not a style recipe');
    expect(taste).toContain('reconsider the idea rather than adding more elements');
    expect(taste).toContain('Does The Visual Thinking Develop?');
    expect(production).toContain('subtitle/narration/visual alignment');
    expect(production).toContain('Generate or load');
    expect(production).toContain('linked Storyboard range and representative overlap');
    expect(production).toContain('narrationTimingEvidence');
    expect(production).toContain('returned narration cue sheet');
    expect(agent).toContain('const renderProfile = studioCheckpoint.studioRunId');
    expect(agent).toContain("? 'source'");
    expect(agent).toContain('Studio Composition must keep the locked delivery resolution');
  });

  it('exposes built-in Studio Run metadata to the CLI API', () => {
    const route = read('src/app/api/skills/route.ts');
    const cli = read('packages/makaron-cli/bin/makaron.mjs');

    expect(route).toContain('studioRunRecipe: s.makaron?.studioRunRecipe');
    expect(route).toContain('sourceMediaRequired: s.makaron?.sourceMediaRequired || false');
    expect(cli).toContain("args.includes('--built-in')");
    expect(cli).toContain("case 'studio_recipe'");
    expect(cli).toContain("case 'studio_run'");
    expect(cli).toContain("normalizeRunResponse(data);\n      if (printedText && !json)");
    expect(cli).toContain("if (data.status === 'failed' || data.status === 'aborted') process.exit(1);");
  });
});
