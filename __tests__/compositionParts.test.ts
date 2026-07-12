import { describe, expect, it } from 'vitest';
import {
  assembleCompositionParts,
  COMPOSITION_PART_MAX_CHARS,
  decodeCompositionPartContent,
} from '../src/lib/composition-parts';

describe('composition parts', () => {
  it('assembles numbered workspace parts in deterministic order', () => {
    const result = assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-1/drafts/composition-parts/20-root.js', content: 'function Composition() { return null; }' },
        { path: 'project-1/drafts/composition-parts/00-foundation.js', content: 'const value = 1;' },
      ],
    });

    expect(result.paths[0]).toContain('00-foundation.js');
    expect(result.code.indexOf('const value')).toBeLessThan(result.code.indexOf('function Composition'));
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it('rejects cross-project, duplicate, unnumbered, and oversized parts', () => {
    expect(() => assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-2/drafts/composition-parts/00-foundation.js', content: 'const a = 1;' },
        { path: 'project-1/drafts/composition-parts/10-root.js', content: 'function Composition() {}' },
      ],
    })).toThrow('must be stored under');

    expect(() => assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-1/drafts/composition-parts/foundation.js', content: 'const a = 1;' },
        { path: 'project-1/drafts/composition-parts/10-root.js', content: 'function Composition() {}' },
      ],
    })).toThrow('must be numbered');

    const duplicate = 'project-1/drafts/composition-parts/00-foundation.js';
    expect(() => assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: duplicate, content: 'const a = 1;' },
        { path: duplicate, content: 'const b = 2;' },
      ],
    })).toThrow('Duplicate');

    expect(() => assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-1/drafts/composition-parts/00-foundation.js', content: 'x'.repeat(COMPOSITION_PART_MAX_CHARS + 1) },
        { path: 'project-1/drafts/composition-parts/10-root.js', content: 'function Composition() {}' },
      ],
    })).toThrow('exceeds');
  });

  it('decodes legacy binary workspace source before validating and assembling', () => {
    const source = 'function Composition() { return null; }';
    const encoded = `data:application/octet-stream;base64,${Buffer.from(source).toString('base64')}`;
    expect(decodeCompositionPartContent(encoded)).toBe(source);
    expect(assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-1/drafts/composition-parts/00-foundation.js', content: encoded },
        { path: 'project-1/drafts/composition-parts/90-root.js', content: source },
      ],
    }).code).toContain(source);
  });
});
