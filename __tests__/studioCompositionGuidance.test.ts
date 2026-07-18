import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const guidancePaths = [
  'src/lib/prompts/agent-coding.md',
  'src/lib/prompts/remotion-composition.md',
  'src/skills/_shared/remotion-director-contract.md',
  'src/skills/_shared/visual-direction/SKILL.md',
  'src/skills/_shared/studio-production/taste-direction.md',
];

const optionalLibraries = [
  'src/skills/_shared/remotion-video-director/SKILL.md',
  'src/skills/_shared/remotion-video-director/references/video-archetypes.md',
  'src/skills/_shared/remotion-video-director/references/remotion-patterns.md',
  'src/skills/_shared/remotion-video-director/references/component-library.md',
];

describe('durable Composition guidance preload', () => {
  it('preloads complete core Composition, Director, and Visual Invention files without universal templates', () => {
    const source = read('src/lib/studio-composition-guidance.ts');
    const totalGuidanceChars = guidancePaths.reduce((total, path) => total + read(path).length, 0);

    expect(totalGuidanceChars).toBeGreaterThan(30_000);
    for (const path of guidancePaths) {
      const importPath = path
        .replace(/^src\/lib\//, './')
        .replace(/^src\//, '@/');
      expect(source).toContain(`from '${importPath}'`);
    }
    for (const path of optionalLibraries) {
      const importPath = path.replace(/^src\//, '@/');
      expect(source).not.toContain(`from '${importPath}'`);
    }
    expect(source).toContain('loaded verbatim');
    expect(source).toContain('complete source documents');
    expect(source).toContain('not a summary or fast-path replacement');
    expect(source).toContain('not universal defaults');
    expect(source).toContain('Do not call read_file for any of those paths');
    expect(source).toContain('first creative mutation with write_file');
    expect(source).toContain('when the durable handoff names an existing gated draft');
    expect(source).toContain('does not complete the Composition stage');
    expect(source).toContain('studio_run put_artifact for stage composition');
  });

  it('injects the preload only for the dedicated studio:composition work unit', () => {
    const agent = read('src/lib/agent.ts');
    const preloadBlock = agent.slice(
      agent.indexOf('const durableCompositionGuidance'),
      agent.indexOf('const executionSystemPrompt'),
    );

    expect(preloadBlock).toContain("workUnitKey === 'studio:composition'");
    expect(preloadBlock).toContain('buildDurableCompositionGuidance()');
    expect(agent).toContain('no aggregate source-size or part-count limit');
    expect(agent).toContain('Never shorten approved narration, subtitles, scenes, animation, or visual detail');
  });
});
