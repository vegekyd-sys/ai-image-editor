import { describe, expect, it } from 'vitest';
import { compileEditableManifest } from '@/lib/editor/editable-manifest';

describe('Editable Manifest compiler', () => {
  it('infers and instruments natural text, image, and video prop reads', () => {
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return (
            <AbsoluteFill>
              <h1>{props.title}</h1>
              <Img src={props.heroImage} style={{ width: 800, height: 600 }} />
              <Video src={props.clip} style={{ width: 800, height: 450 }} />
            </AbsoluteFill>
          );
        }
      `,
      props: {
        title: 'Spatial computing',
        heroImage: 'https://example.com/hero.jpg',
        clip: 'https://example.com/clip.mp4',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      { id: 'heroImage', type: 'image', label: 'Hero image', propKey: 'heroImage' },
      { id: 'clip', type: 'video', label: 'Clip', propKey: 'clip' },
    ]);
    expect(result.code).toContain('<h1 data-editable="title">');
    expect(result.code).toContain('<Img src={props.heroImage} style={{ width: 800, height: 600 }}  data-editable="heroImage"/>');
    expect(result.code).toContain('<Video src={props.clip} style={{ width: 800, height: 450 }}  data-editable="clip"/>');
  });

  it('supports bracket prop reads without explicit metadata', () => {
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return <div>{props["headline"]}</div>;
        }
      `,
      props: { headline: 'Hello' },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'headline', type: 'text', label: 'Headline', propKey: 'headline' },
    ]);
    expect(result.code).toContain('data-editable="headline"');
  });

  it('infers dynamic scene keys from an explicit runtime id escape hatch', () => {
    const result = compileEditableManifest({
      code: `
        const scenes = [
          { titleKey: 'title0', imageKey: 'image0' },
          { titleKey: 'title1', imageKey: 'image1' },
        ];
        function Composition(props) {
          const scene = scenes[0];
          return (
            <div>
              <h1 data-editable={scene.titleKey}>{props[scene.titleKey]}</h1>
              <div data-editable={scene.imageKey}>
                <Img src={props[scene.imageKey]} />
              </div>
            </div>
          );
        }
      `,
      props: {
        title0: 'One',
        title1: 'Two',
        image0: 'https://example.com/one.jpg',
        image1: 'https://example.com/two.jpg',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title0', type: 'text', label: 'Title 0', propKey: 'title0' },
      { id: 'title1', type: 'text', label: 'Title 1', propKey: 'title1' },
      { id: 'image0', type: 'image', label: 'Image 0', propKey: 'image0' },
      { id: 'image1', type: 'image', label: 'Image 1', propKey: 'image1' },
    ]);
  });

  it('preserves explicit legacy metadata and does not duplicate its marker', () => {
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return <h1 data-editable="title">{props.title}</h1>;
        }
      `,
      props: { title: 'Hello' },
      editables: [
        { id: 'title', type: 'text', label: 'Opening title', propKey: 'title' },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title', type: 'text', label: 'Opening title', propKey: 'title' },
    ]);
    expect(result.code.match(/data-editable/g)).toHaveLength(1);
  });

  it('maps an explicitly named media wrapper to the nested source prop', () => {
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return (
            <div data-editable="hero">
              <Img src={props.heroImage} />
            </div>
          );
        }
      `,
      props: { heroImage: 'https://example.com/hero.jpg' },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'hero', type: 'image', label: 'Hero', propKey: 'heroImage' },
    ]);
  });

  it('is idempotent when the normalized composition is compiled again', () => {
    const input = {
      code: `
        function Composition(props) {
          return (
            <div>
              <h1>{props.title}</h1>
              <Video src={props.clip} />
            </div>
          );
        }
      `,
      props: {
        title: 'Hello',
        clip: 'https://example.com/clip.mp4',
      },
    };
    const first = compileEditableManifest(input);
    const second = compileEditableManifest({
      code: first.code,
      props: input.props,
      editables: first.editables,
    });

    expect(second).toEqual(first);
    expect(second.code.match(/data-editable/g)).toHaveLength(2);
  });

  it('follows props through a reusable editable helper component', () => {
    const result = compileEditableManifest({
      code: `
        function EditableText({ id, value }) {
          return <h1 data-editable={id}>{value}</h1>;
        }
        function EditableImage({ id, src }) {
          return <Img data-editable={id} src={src} />;
        }
        function Composition(props) {
          return (
            <div>
              <EditableText id="title" value={props.title} />
              <EditableImage id="hero" src={props.heroImage} />
            </div>
          );
        }
      `,
      props: {
        title: 'Hello',
        heroImage: 'https://example.com/hero.jpg',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      { id: 'hero', type: 'image', label: 'Hero', propKey: 'heroImage' },
    ]);
  });

  it('expands dynamic helper calls from scene keys', () => {
    const result = compileEditableManifest({
      code: `
        const scenes = [
          { titleKey: 'title0' },
          { titleKey: 'title1' },
        ];
        const EditableText = ({ id, value }) => (
          <h1 data-editable={id}>{value}</h1>
        );
        function Composition(props) {
          const scene = scenes[0];
          return <EditableText id={scene.titleKey} value={props[scene.titleKey]} />;
        }
      `,
      props: {
        title0: 'One',
        title1: 'Two',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title0', type: 'text', label: 'Title 0', propKey: 'title0' },
      { id: 'title1', type: 'text', label: 'Title 1', propKey: 'title1' },
    ]);
  });

  it('reports an ambiguous host instead of inventing one logical text node', () => {
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return <h1>{props.first} {props.last}</h1>;
        }
      `,
      props: { first: 'Ada', last: 'Lovelace' },
    });

    expect(result.editables).toEqual([]);
    expect(result.diagnostics).toEqual([
      'JSX host <h1> renders multiple editable props (first, last). Wrap each value in its own element or add an explicit data-editable host.',
    ]);
  });
});
