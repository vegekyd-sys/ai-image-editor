import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeAgentErrorMessage } from '@/lib/agent-error';

describe('headless agent error handling', () => {
  it('preserves provider object messages instead of emitting object Object', () => {
    expect(normalizeAgentErrorMessage({ type: 'api_error', message: 'Internal server error' })).toBe('Internal server error');
    expect(normalizeAgentErrorMessage({ code: 'bad_gateway' })).toBe('{"code":"bad_gateway"}');
  });

  it('marks a headless stream error as failed', () => {
    const route = readFileSync(path.resolve(process.cwd(), 'src/app/api/agent/run/route.ts'), 'utf8');
    expect(route).toContain("if (event.type === 'error') {");
    expect(route).toContain('sawError = true');
    expect(route).toContain('resolvePersistedRunStatus({');
    expect(route).toContain('status: terminalStatus');
  });
});
