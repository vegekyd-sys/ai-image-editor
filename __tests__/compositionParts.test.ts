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
    })).toThrow('numeric prefix');

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

  it('preserves rich multi-scene compositions without aggregate size or part-count trimming', () => {
    const richParts = Array.from({ length: 10 }, (_, index) => ({
      path: `project-1/drafts/composition-parts/${String(index).padStart(2, '0')}-scene.js`,
      content: 'x'.repeat(3_000),
    }));
    expect(assembleCompositionParts({ projectId: 'project-1', parts: richParts }).totalChars)
      .toBe(30_000);

    const longFormParts = Array.from({ length: 120 }, (_, index) => ({
      path: `project-1/drafts/composition-parts/${String(index).padStart(3, '0')}-scene.js`,
      content: `const scene${index} = ${index};`,
    }));
    const assembled = assembleCompositionParts({ projectId: 'project-1', parts: longFormParts });
    expect(assembled.paths).toHaveLength(120);
    expect(assembled.code).toContain('const scene119 = 119;');
  });

  it('orders numeric prefixes correctly beyond two digits', () => {
    const assembled = assembleCompositionParts({
      projectId: 'project-1',
      parts: [
        { path: 'project-1/drafts/composition-parts/120-ending.js', content: 'const ending = true;' },
        { path: 'project-1/drafts/composition-parts/20-middle.js', content: 'const middle = true;' },
        { path: 'project-1/drafts/composition-parts/00-start.js', content: 'const start = true;' },
      ],
    });
    expect(assembled.paths.map(path => path.split('/').at(-1)))
      .toEqual(['00-start.js', '20-middle.js', '120-ending.js']);
  });
});
