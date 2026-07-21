import { describe, expect, it } from 'vitest';
import { validateDesign } from '@/lib/design-harness';
import { isDirectRemotionCompositionSource } from '@/lib/remotion-code-normalization';

describe('design harness compile preflight', () => {
  it('accepts DynamicDesign function-body code', () => {
    expect(validateDesign({
      code: 'function Composition() { return <AbsoluteFill><div>Ready</div></AbsoluteFill>; }',
    })).toBeNull();
  });

  it('accepts natural ESM composition modules', () => {
    expect(validateDesign({
      code: "import React from 'react'; import { AbsoluteFill } from 'remotion'; export default function Composition() { return <AbsoluteFill />; }",
    })).toBeNull();
  });

  it('accepts lexical declarations that shadow injected Remotion names', () => {
    expect(validateDesign({
      code: 'const Composition = () => <AbsoluteFill />;',
    })).toBeNull();
  });

  it('accepts CommonJS for browser-provided composition modules', () => {
    expect(validateDesign({
      code: "const { AbsoluteFill } = require('remotion'); const Draft = () => <AbsoluteFill />; module.exports = Draft;",
    })).toBeNull();
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

  it('keeps the lowercase video compatibility rewrite', () => {
    const result = {
      code: 'function Composition() { return <video src="https://example.com/source.mp4" autoPlay controls playsInline />; }',
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.code).toContain('<Video');
    expect(result.code).not.toContain('<video');
    expect(result.code).not.toContain('autoPlay');
    expect(result.code).not.toContain('controls');
    expect(result.code).not.toContain('playsInline');
  });

  it('rewrites React.createElement lowercase video calls too', () => {
    const result = {
      code: "function Composition() { return React.createElement('video', {src: 'https://example.com/source.mp4', autoPlay: true}); }",
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.code).toContain('React.createElement(Video');
    expect(result.code).not.toContain('autoPlay');
  });
});

describe('natural Remotion source detection', () => {
  it('recognizes JSX modules saved directly through code_path', () => {
    expect(isDirectRemotionCompositionSource(`
      import {AbsoluteFill} from 'remotion';
      export const Composition = () => <AbsoluteFill />;
    `)).toBe(true);
  });

  it('does not confuse the legacy outer render body with direct JSX source', () => {
    expect(isDirectRemotionCompositionSource(`
      const code = \`function Composition() { return <AbsoluteFill />; }\`;
      return {type: 'render', code, width: 1080, height: 1920};
    `)).toBe(false);
  });
});
