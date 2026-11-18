import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Agent model provider group layout', () => {
  it('uses translucent group headings and keeps CUI headers in the list flow', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const headerRule = css.match(/\.mkr-agent-model-group-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(headerRule).toContain('position: sticky');
    expect(headerRule).toMatch(/top:\s*0/);
    expect(headerRule).toMatch(/z-index:\s*[1-9]/);
    expect(headerRule).not.toMatch(/background/);

    const compactRule = css.match(/\.mkr-create-model-scroll \.mkr-agent-model-group-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(compactRule).toMatch(/background-color:\s*rgba\(23,22,28,0\.\d+\)/);
    expect(compactRule).toContain('backdrop-filter: blur(');

    const cuiHeaderRule = css.match(/\.model-selector-scroll\s*>\s*\.mkr-agent-model-group-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(cuiHeaderRule).toContain('position: static');
    expect(cuiHeaderRule).toContain('top: auto');
    expect(cuiHeaderRule).toContain('z-index: auto');

    for (const provider of ['codex', 'grok']) {
      const selector = `.mkr-agent-model-group-header[data-agent-provider-group="${provider}"]`;
      const declarations = css.split('}')
        .map(rule => rule.split('{'))
        .filter(([selectors]) => selectors.split(',').some(candidate => candidate.trim() === selector))
        .map(([, body]) => body)
        .join('\n');
      expect(declarations).toContain('background-image: linear-gradient(');
      expect(declarations).not.toMatch(/background(?:-color)?:|#17161c/);
    }
  });
});
