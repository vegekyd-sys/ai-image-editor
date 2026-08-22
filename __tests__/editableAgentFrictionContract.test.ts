import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Editable Agent friction benchmark contract', () => {
  it('keeps the no-rewrite advisory policy aligned with production prompts', () => {
    const benchmark = readFileSync(
      path.join(process.cwd(), 'benchmarks/editable-agent-friction.ts'),
      'utf8',
    );
    const productionPrompt = readFileSync(
      path.join(process.cwd(), 'src/lib/prompts/remotion-composition.md'),
      'utf8',
    );
    const agentTools = readFileSync(
      path.join(process.cwd(), 'src/lib/agent-tools.ts'),
      'utf8',
    );

    expect(benchmark).toContain("toolChoice: 'required'");
    expect(benchmark).toContain('ready-editable-coverage-advisory');
    expect(benchmark).toContain('blocking-syntax-control');
    expect(productionPrompt).toContain('Editable coverage is opportunistic and fail-soft.');
    expect(agentTools).toContain('Editable coverage is fail-soft:');
  });
});
