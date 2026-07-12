import { describe, expect, it } from 'vitest';
import { validateDesign } from '@/lib/design-harness';

describe('design harness compile preflight', () => {
  it('accepts DynamicDesign function-body code', () => {
    expect(validateDesign({
      code: 'function Composition() { return <AbsoluteFill><div>Ready</div></AbsoluteFill>; }',
    })).toBeNull();
  });

  it('rejects module syntax before remote frame rendering', () => {
    expect(validateDesign({
      code: 'export function Composition() { return <AbsoluteFill />; }',
    })).toMatch(/import\/export module syntax is not supported/);
  });

  it('rejects declarations that collide with the injected Remotion scope', () => {
    expect(validateDesign({
      code: 'const Composition = () => <AbsoluteFill />;',
    })).toMatch(/Identifier 'Composition' has already been declared/);
  });

  it('rejects CommonJS calls that would fail in the browser runtime', () => {
    expect(validateDesign({
      code: "const { AbsoluteFill } = require('remotion'); function Draft() { return <AbsoluteFill />; }",
    })).toMatch(/require\/module\.exports syntax is not supported/);
  });

  it('accepts the injected THREE namespace without an import', () => {
    expect(validateDesign({
      code: 'function ThreeDesign() { const color = new THREE.Color("#d946ef"); return <AbsoluteFill style={{backgroundColor: color.getStyle()}} />; }',
    })).toBeNull();
  });

  it('rejects missing constants and components before runtime rendering', () => {
    expect(validateDesign({
      code: 'function Design() { return <AbsoluteFill style={{background: THEME.bg}}><Captions src={VO_URL} /></AbsoluteFill>; }',
    })).toMatch(/unresolved identifiers Captions, THEME, VO_URL/);
  });

  it('accepts lexical bindings, browser globals, and injected Remotion helpers', () => {
    expect(validateDesign({
      code: `
        const THEME = {bg: '#000'};
        function Captions({text}: {text: string}) { return <div>{text.toUpperCase()}</div>; }
        function Design() {
          const values = Array.from({length: 2}, (_, i) => interpolate(i, [0, 1], [0, 10]));
          return <AbsoluteFill style={{background: THEME.bg}}><Captions text={String(Math.max(...values))} /></AbsoluteFill>;
        }
      `,
    })).toBeNull();
  });
});
