import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPENMONTAGE_SKILL_CATALOG,
  OPENMONTAGE_SOURCE_AGENT_SKILL_COUNT,
  OPENMONTAGE_SOURCE_PIPELINE_COUNT,
  getMigratedOpenMontageSkills,
  getOpenMontageCoverageSummary,
} from '@/lib/openmontage-skill-catalog';
import { parseSkillMd } from '@/lib/skill-registry';
import { getSkillManifest } from '@/lib/workspace';

const root = path.resolve(__dirname, '..');

const sourceAgentSkills = [
  'acestep', 'agents', 'ai-video-gen', 'avatar-video', 'beautiful-mermaid', 'bfl-api',
  'canvas-procedural-animation', 'character-animation-qa', 'character-rigging', 'comfyui',
  'create-video', 'd3-viz', 'dashscope', 'doubao-tts', 'elevenlabs', 'faceswap', 'ffmpeg',
  'flux-best-practices', 'framer-motion', 'grok-media', 'gsap-core', 'gsap-frameworks',
  'gsap-performance', 'gsap-plugins', 'gsap-react', 'gsap-scrolltrigger', 'gsap-timeline',
  'gsap-utils', 'heygen', 'hyperframes', 'hyperframes-animation', 'hyperframes-cli',
  'hyperframes-core', 'hyperframes-creative', 'hyperframes-media', 'hyperframes-registry',
  'lottie-bodymovin', 'ltx2', 'manim-composer', 'manimce-best-practices',
  'manimgl-best-practices', 'media-use', 'motion-graphics', 'music', 'music-to-video',
  'playwright-recording', 'pose-library-design', 'remotion', 'remotion-best-practices',
  'remotion-to-hyperframes', 'seedance-2-0', 'setup-api-key', 'sound-effects',
  'speech-to-text', 'svg-character-animation', 'synthetic-screen-recording',
  'tailwind-design-system', 'text-to-speech', 'threejs-animation', 'threejs-fundamentals',
  'threejs-geometry', 'threejs-interaction', 'threejs-lighting', 'threejs-loaders',
  'threejs-materials', 'threejs-postprocessing', 'threejs-shaders', 'threejs-textures',
  'vercel-composition-patterns', 'vercel-react-best-practices', 'video-download',
  'video-edit', 'video-toolkit', 'video-translate', 'video-understand', 'visual-style',
  'web-design-guidelines', 'website-to-video',
] as const;

const sourcePipelines = [
  'animated-explainer', 'animation', 'avatar-spokesperson', 'character-animation',
  'cinematic', 'clip-factory', 'documentary-montage', 'framework-smoke', 'hybrid',
  'localization-dub', 'podcast-repurpose', 'screen-demo', 'talking-head',
] as const;

describe('OpenMontage full skill migration', () => {
  it('accounts for every source skill and pipeline in the locked source snapshot', () => {
    const agentNames = OPENMONTAGE_SKILL_CATALOG
      .filter(entry => entry.sourceKind === 'agent-skill')
      .map(entry => entry.name)
      .sort();
    const pipelineNames = OPENMONTAGE_SKILL_CATALOG
      .filter(entry => entry.sourceKind === 'pipeline')
      .map(entry => entry.name)
      .sort();

    expect(agentNames).toEqual([...sourceAgentSkills].sort());
    expect(pipelineNames).toEqual([...sourcePipelines].sort());
    expect(agentNames).toHaveLength(OPENMONTAGE_SOURCE_AGENT_SKILL_COUNT);
    expect(pipelineNames).toHaveLength(OPENMONTAGE_SOURCE_PIPELINE_COUNT);
    expect(getOpenMontageCoverageSummary()).toEqual({ native: 36, adapted: 11, excluded: 8, unavailable: 36 });
  });

  it('excludes only HyperFrames and records non-product capabilities honestly', () => {
    const excluded = OPENMONTAGE_SKILL_CATALOG.filter(entry => entry.supportLevel === 'excluded').map(entry => entry.name).sort();
    expect(excluded).toEqual([
      'hyperframes', 'hyperframes-animation', 'hyperframes-cli', 'hyperframes-core',
      'hyperframes-creative', 'hyperframes-media', 'hyperframes-registry', 'remotion-to-hyperframes',
    ]);
    const unavailable = OPENMONTAGE_SKILL_CATALOG.filter(entry => entry.supportLevel === 'unavailable').map(entry => entry.name).sort();
    expect(unavailable).toEqual([
      'acestep', 'agents', 'avatar-video', 'beautiful-mermaid', 'bfl-api', 'd3-viz',
      'dashscope', 'elevenlabs', 'faceswap', 'flux-best-practices', 'framer-motion',
      'framework-smoke', 'gsap-core', 'gsap-frameworks', 'gsap-performance',
      'gsap-plugins', 'gsap-react', 'gsap-scrolltrigger', 'gsap-timeline', 'gsap-utils',
      'heygen', 'lottie-bodymovin', 'ltx2', 'manim-composer',
      'manimce-best-practices', 'manimgl-best-practices', 'playwright-recording',
      'setup-api-key', 'tailwind-design-system', 'threejs-interaction',
      'threejs-loaders', 'threejs-postprocessing', 'vercel-composition-patterns',
      'vercel-react-best-practices', 'video-download', 'video-toolkit',
    ]);
    for (const entry of OPENMONTAGE_SKILL_CATALOG.filter(item => ['excluded', 'unavailable'].includes(item.supportLevel))) {
      expect(entry.reason).toBeTruthy();
    }
    for (const entry of OPENMONTAGE_SKILL_CATALOG.filter(item => item.sourceKind === 'agent-skill' && item.supportLevel === 'unavailable')) {
      expect(existsSync(path.join(root, 'src', 'skills', entry.name, 'SKILL.md')), entry.name).toBe(false);
    }
  });

  it('materializes every supported source name as a Makaron built-in skill', () => {
    const migrated = getMigratedOpenMontageSkills();
    expect(migrated).toHaveLength(47);
    for (const entry of migrated) {
      const file = path.join(root, 'src', 'skills', entry.name, 'SKILL.md');
      expect(existsSync(file), entry.name).toBe(true);
      const parsed = parseSkillMd(readFileSync(file, 'utf8'));
      expect(parsed?.name).toBe(entry.name);
      expect(parsed?.makaron.builtIn).toBe(true);
      expect(parsed?.makaron.sourceProject).toBe('openmontage');
      expect(parsed?.makaron.sourceSkill).toBe(entry.name);
      expect(parsed?.makaron.supportLevel).toBe(entry.supportLevel);
      expect(parsed?.allowedTools).not.toContain('hyperframes');
    }
  });

  it('keeps only provider skills with real Makaron execution routes', () => {
    const seedance = readFileSync(path.join(root, 'src/skills/seedance-2-0/SKILL.md'), 'utf8');
    expect(seedance).not.toContain('Read `skills/photo-to-video/SKILL.md`');
    expect(seedance).toContain('native text-to-video');
    expect(seedance).toContain('low-cost draft/mini to `seedance-mini`');
    expect(existsSync(path.join(root, 'src/skills/bfl-api/SKILL.md'))).toBe(false);
    expect(existsSync(path.join(root, 'src/skills/dashscope/SKILL.md'))).toBe(false);
  });

  it('keeps internal craft adapters out of the per-run manifest', async () => {
    const manifest = await getSkillManifest();
    expect(manifest).not.toContain('**gsap-core**');
    expect(manifest).not.toContain('**threejs-shaders**');
    expect(manifest).toContain('**music-to-video**');
    expect(manifest).toContain('**website-to-video**');
    expect(manifest).toContain('**avatar-spokesperson**');
  });

  it('exposes exactly the new user-facing OpenMontage workflows without losing existing ones', () => {
    const selectable = getMigratedOpenMontageSkills()
      .filter(entry => entry.userSelectable)
      .map(entry => entry.name)
      .sort();
    expect(selectable).toEqual([
      'avatar-spokesperson', 'character-animation', 'localization-dub',
      'music-to-video', 'screen-demo', 'website-to-video',
    ]);
  });
});
