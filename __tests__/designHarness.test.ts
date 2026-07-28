import { describe, expect, it } from 'vitest';
import { validateDesign, validateDesignReport } from '@/lib/design-harness';
import { isDirectRemotionCompositionSource } from '@/lib/remotion-code-normalization';

describe('design harness compile preflight', () => {
  it('accepts DynamicDesign function-body code', () => {
    expect(validateDesign({
      code: 'function Composition(props) { return <AbsoluteFill><div data-editable="status">{props.status}</div></AbsoluteFill>; }',
      props: { status: 'Ready' },
      editables: [{ id: 'status', type: 'text', label: 'Status', propKey: 'status' }],
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
    expect(result.code).toContain('autoPlay');
  });

  it('does not strip autoPlay from unrelated components or objects', () => {
    const result = {
      code: 'const settings = {autoPlay: true}; const Player = () => <div />; function Composition() { return <Player autoPlay />; }',
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.code).toContain('{autoPlay: true}');
    expect(result.code).toContain('<Player autoPlay');
  });

  it('does not validate video and audio src values as image URLs', () => {
    expect(validateDesign({
      code: 'function Composition() { return <><Video src="data:video/mp4;base64,AAAA" /><Audio src="/audio.mp3" /></>; }',
    })).toBeNull();
  });

  it('keeps mechanically valid compositions publishable when editable inference is partial', () => {
    const design = {
      code: `
        function Composition(props) {
          return <AbsoluteFill><h1>{props.brand} {props.tagline}</h1></AbsoluteFill>;
        }
      `,
      props: { brand: 'ROG', tagline: 'For those who dare' },
    };

    const report = validateDesignReport(design);

    expect(report.blocking).toEqual([]);
    expect(report.advisories.join('\n')).toContain('renders multiple editable props');
    expect(validateDesign(design)).toBeNull();
  });

  it('keeps compiler-owned image and literal fields valid on repeated validation', () => {
    const design = {
      code: `
        function Composition(props) {
          return (
            <AbsoluteFill>
              <Img src={props.image} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
              <h1>Inference ready</h1>
            </AbsoluteFill>
          );
        }
      `,
      props: {
        image: 'https://example.com/input.jpg',
      },
      editables: undefined as import('@/types').EditableField[] | undefined,
    };

    expect(validateDesign(design)).toBeNull();
    const firstEditables = design.editables;
    expect(firstEditables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'image', type: 'image' }),
      expect.objectContaining({ type: 'text', source: 'literal' }),
    ]));

    expect(validateDesign(design)).toBeNull();
    expect(design.editables).toEqual(firstEditables);
  });

  it('keeps compiler-owned scene-selected media valid on repeated validation', () => {
    const design = {
      code: `
        const scenes = [
          {id: 'input', img: 'input'},
          {id: 'output', img: 'output'},
        ];
        function Scene({scene, src}) {
          return <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />;
        }
        function Composition(props) {
          return (
            <AbsoluteFill>
              {scenes.map(scene => <Scene key={scene.id} scene={scene} src={props[scene.img]} />)}
            </AbsoluteFill>
          );
        }
      `,
      props: {
        input: 'https://example.com/input.jpg',
        output: 'https://example.com/output.jpg',
      },
      editables: undefined as import('@/types').EditableField[] | undefined,
    };

    expect(validateDesign(design)).toBeNull();
    const firstEditables = design.editables;
    expect(firstEditables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'input', type: 'image' }),
      expect.objectContaining({ id: 'output', type: 'image' }),
    ]));

    expect(validateDesign(design)).toBeNull();
    expect(design.editables).toEqual(firstEditables);
  });

  it('still blocks mechanical failures when editable inference is partial', () => {
    const design = {
      code: `
        function Composition(props) {
          return <AbsoluteFill><MissingLayer /><h1>{props.brand} {props.tagline}</h1></AbsoluteFill>;
        }
      `,
      props: { brand: 'ROG', tagline: 'For those who dare' },
    };

    const report = validateDesignReport(design);

    expect(report.blocking.join('\n')).toContain('MissingLayer');
    expect(validateDesign(design)).toContain('MissingLayer');
  });

  it('accepts persisted compiler manifests with dynamic conditional ownership', () => {
    const design = {
      code: `
        function ProductLines({ lines }) {
          return lines.map((line, index) => (
            <div
              key={line}
              data-editable={index === 0 ? 'productLine1' : index === 1 ? 'productLine2' : 'productLine3'}
            >
              {line}
            </div>
          ));
        }
        function Composition(props) {
          return <AbsoluteFill><ProductLines lines={props.productLines} /></AbsoluteFill>;
        }
      `,
      props: {
        productLines: ['STRIX', 'ZEPHYRUS', 'FLOW'],
        productLine1: 'STRIX',
        productLine2: 'ZEPHYRUS',
        productLine3: 'FLOW',
      },
      editables: [
        { id: 'productLine1', type: 'text' as const, label: 'Product line 1', propKey: 'productLine1' },
        { id: 'productLine2', type: 'text' as const, label: 'Product line 2', propKey: 'productLine2' },
        { id: 'productLine3', type: 'text' as const, label: 'Product line 3', propKey: 'productLine3' },
      ],
    };

    expect(validateDesignReport(design).blocking).toEqual([]);
    expect(validateDesign(design)).toBeNull();
  });

  it('still blocks legacy editable metadata with no visible owner', () => {
    const design = {
      code: 'function Composition() { return <AbsoluteFill />; }',
      props: { orphanTitle: 'Invisible title' },
      editables: [
        { id: 'orphanTitle', type: 'text' as const, label: 'Orphan title', propKey: 'orphanTitle' },
      ],
    };

    expect(validateDesign(design)).toContain('no JSX element has data-editable="orphanTitle"');
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
