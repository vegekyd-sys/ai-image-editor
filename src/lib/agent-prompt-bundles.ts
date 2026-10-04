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
