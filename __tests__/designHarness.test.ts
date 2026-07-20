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

  it('rejects Remotion hooks called while evaluating the composition source', () => {
    expect(validateDesign({
      code: `
        const {width, height} = useVideoConfig();
        function Composition() { return <AbsoluteFill>{width}x{height}</AbsoluteFill>; }
      `,
    })).toMatch(/useVideoConfig called outside a component or custom hook/);
  });

  it('accepts Remotion hooks inside components', () => {
    expect(validateDesign({
      code: `
        function Composition() {
          const {width, height} = useVideoConfig();
          const frame = useCurrentFrame();
          return <AbsoluteFill>{width}x{height} at {frame}</AbsoluteFill>;
        }
      `,
    })).toBeNull();
  });

  it('rejects native HTML video without silently rewriting the decoder', () => {
    const result = {
      code: 'function Composition() { return <video src="https://example.com/source.mp4" autoPlay />; }',
    };

    expect(validateDesign(result)).toMatch(/native HTML <video> is not frame-synchronized/);
    expect(result.code).toContain('<video');
    expect(result.code).not.toContain('<Video');
  });
});
