import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Agent model provider group layout', () => {
  it('keeps provider identity visible while the model list scrolls', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const headerRule = css.match(/\.mkr-agent-model-group-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(headerRule).toContain('position: sticky');
    expect(headerRule).toMatch(/top:\s*0/);
    expect(headerRule).toMatch(/z-index:\s*[1-9]/);
    expect(headerRule).toContain('background: #17161c');

    const personalRule = css.match(/\.mkr-agent-model-group-header\[data-agent-provider-group="codex"\][\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    expect(personalRule).toContain('#17161c');
    expect(css).toContain('.mkr-agent-model-group-header[data-agent-provider-group="grok"]');
  });
});
