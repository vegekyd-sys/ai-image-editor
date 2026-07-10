import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('agent reliability policy', () => {
  it('raises the normal agent budget while keeping an environment override', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain("process.env.AGENT_MAX_STEPS");
    expect(agent).toContain(': 60;');
    expect(agent).toContain('Math.min(120, Math.max(30, configuredMaxSteps))');
  });

  it('autosaves every successful composition render and patch', () => {
    const agent = read('src/lib/agent.ts');
    const coding = read('src/lib/prompts/agent-coding.md');
    expect(agent.match(/persistCompositionDraft\(\{/g)).toHaveLength(2);
    expect(agent).toContain('code_path: autosave.path');
    expect(agent).toContain('design_path: z.string().optional()');
    expect(agent).not.toContain('Draft is not saved yet');
    expect(coding).toContain('immediately autosaved to the workspace recovery path');
  });

  it('exposes Studio Run stage schemas and validation without persisting', () => {
    const agent = read('src/lib/agent.ts');
    expect(agent).toContain("'schema', 'validate'");
    expect(agent).toContain('currentStageSchema');
    expect(agent).toContain('getStudioArtifactJsonSchema');
    expect(agent).toContain("operation === 'validate'");
  });
});
