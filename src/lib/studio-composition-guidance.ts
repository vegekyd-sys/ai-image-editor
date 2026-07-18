import agentCodingPrompt from './prompts/agent-coding.md';
import remotionCompositionPrompt from './prompts/remotion-composition.md';
import remotionDirectorContract from '@/skills/_shared/remotion-director-contract.md';
import visualDirection from '@/skills/_shared/visual-direction/SKILL.md';
import tasteDirection from '@/skills/_shared/studio-production/taste-direction.md';

export const PRELOADED_COMPOSITION_GUIDANCE_PATHS = [
  'prompts/agent-coding.md',
  'prompts/remotion-composition.md',
  'skills/_shared/remotion-director-contract.md',
  'skills/_shared/visual-direction/SKILL.md',
  'skills/_shared/studio-production/taste-direction.md',
] as const;

const PRELOADED_COMPOSITION_GUIDANCE = [
  agentCodingPrompt,
  remotionCompositionPrompt,
  remotionDirectorContract,
  visualDirection,
  tasteDirection,
] as const;

export function buildDurableCompositionGuidance(): string {
  const documents = PRELOADED_COMPOSITION_GUIDANCE_PATHS.map((path, index) => (
    `<repository-guidance path="${path}">\n${PRELOADED_COMPOSITION_GUIDANCE[index]}\n</repository-guidance>`
  ));

  return [
    '',
    '## Preloaded Composition, Director, and Visual Invention guidance',
    'The following core repository files are loaded verbatim for this dedicated Composition attempt. They are complete source documents, not a summary or fast-path replacement. Large archetype and component libraries remain available for selective reading after the direction calls for them; they are not universal defaults.',
    ...documents,
    '## Composition attempt execution order',
    'The guidance above is already in this model context. Do not call read_file for any of those paths in this attempt.',
    'After studio_run status, read only the persisted Script, Storyboard, Asset Manifest, and any exact prepared-asset records needed by the current Composition stage.',
    'Then make the first creative mutation with write_file under the numbered composition-parts directory. Preserve the complete approved direction and use as many parts as it needs.',
    'Recovery rule: when the durable handoff names an existing gated draft, do not rebuild, rerun, re-preview, or republish it. Reuse the persisted design path and Draft Gate evidence.',
    'Completion rule: a successful write_file publish does not complete the Composition stage. Before ending the attempt, call studio_run put_artifact for stage composition with the real design path and Draft Gate evidence. If the exact artifact contract is not present, call studio_run schema for composition once, then submit it.',
  ].join('\n\n');
}
