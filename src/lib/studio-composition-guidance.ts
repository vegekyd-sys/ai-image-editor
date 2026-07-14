import agentCodingPrompt from './prompts/agent-coding.md';
import remotionCompositionPrompt from './prompts/remotion-composition.md';
import remotionDirectorContract from '@/skills/_shared/remotion-director-contract.md';
import remotionVideoDirector from '@/skills/_shared/remotion-video-director/SKILL.md';
import videoArchetypes from '@/skills/_shared/remotion-video-director/references/video-archetypes.md';
import remotionPatterns from '@/skills/_shared/remotion-video-director/references/remotion-patterns.md';
import componentLibrary from '@/skills/_shared/remotion-video-director/references/component-library.md';
import visualDirection from '@/skills/_shared/visual-direction/SKILL.md';

export const PRELOADED_COMPOSITION_GUIDANCE_PATHS = [
  'prompts/agent-coding.md',
  'prompts/remotion-composition.md',
  'skills/_shared/remotion-director-contract.md',
  'skills/_shared/remotion-video-director/SKILL.md',
  'skills/_shared/remotion-video-director/references/video-archetypes.md',
  'skills/_shared/remotion-video-director/references/remotion-patterns.md',
  'skills/_shared/remotion-video-director/references/component-library.md',
  'skills/_shared/visual-direction/SKILL.md',
] as const;

const PRELOADED_COMPOSITION_GUIDANCE = [
  agentCodingPrompt,
  remotionCompositionPrompt,
  remotionDirectorContract,
  remotionVideoDirector,
  videoArchetypes,
  remotionPatterns,
  componentLibrary,
  visualDirection,
] as const;

export function buildDurableCompositionGuidance(): string {
  const documents = PRELOADED_COMPOSITION_GUIDANCE_PATHS.map((path, index) => (
    `<repository-guidance path="${path}">\n${PRELOADED_COMPOSITION_GUIDANCE[index]}\n</repository-guidance>`
  ));

  return [
    '',
    '## Preloaded original Composition and Director guidance',
    'The following repository files are loaded verbatim for this dedicated Composition attempt. They are the original guidance, not a summary or fast-path replacement.',
    ...documents,
    '## Composition attempt execution order',
    'The guidance above is already in this model context. Do not call read_file for any of those paths in this attempt.',
    'After studio_run status, read only the persisted Script, Storyboard, Asset Manifest, and any exact prepared-asset records needed by the current Composition stage.',
    'Then make the first creative mutation with write_file under the numbered composition-parts directory. Preserve the complete approved direction and use as many parts as it needs.',
  ].join('\n\n');
}
