import { createHash } from 'node:crypto';
import editorialSeeds from '../skills/tiktok-video/references/editorial-seeds.md';
import videoWorkflow from './prompts/video-workflow.md';
import videoSubmission from './prompts/video-submission.md';
import codingWorkflow from './prompts/coding-workflow.md';
import codingSubmission from './prompts/coding-submission.md';
import workspaceAuthoring from './prompts/workspace-authoring.md';

/** Static dependencies, not user-intent routing. One guide read delivers its
 * complete contract without extra model turns. Explicit imports also ensure
 * the deferred documents are packaged in serverless builds. */
export const AGENT_PROMPT_BUNDLES: Readonly<Record<string, readonly { path: string; content: string }[]>> = {
  'prompts/animate.md': [
    { path: 'prompts/video-workflow.md', content: videoWorkflow },
    { path: 'prompts/video-submission.md', content: videoSubmission },
  ],
  'prompts/agent-coding.md': [
    { path: 'prompts/coding-workflow.md', content: codingWorkflow },
    { path: 'prompts/coding-submission.md', content: codingSubmission },
    { path: 'prompts/workspace-authoring.md', content: workspaceAuthoring },
  ],
};

export function bundleAgentPrompt(path: string, content: string): string {
  if (!Object.hasOwn(AGENT_PROMPT_BUNDLES, path)) return content;
  const dependencies = AGENT_PROMPT_BUNDLES[path];
  if (!dependencies) return content;
  return content + dependencies.map(part => `\n\n[Bundled contract: ${part.path}]\n\n${part.content}`).join('');
}

/** Stable across retries of the same cut. Each axis uses a separate digest byte. */
export function resolveTikTokEditorialSeed(content: string, runId: string): string {
  const bytes = createHash('sha256').update(runId).digest();
  const sections = editorialSeeds.split(/^## [ABC]\. .*$/m).slice(1);
  const suggestion = sections.map((section, i) => {
    const choices = [...section.matchAll(/^\d+\. (.+)$/gm)];
    const index = bytes[i] % choices.length;
    return `${'ABC'[i]}${index + 1}. ${choices[index][1]}`;
  });
  return content.replace('{{editorial-seed}}', [
    'Starting direction for this cut (adapt to the brief and available footage):',
    ...suggestion,
  ].join('\n'));
}
