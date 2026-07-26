import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';
import { compileEditableManifest } from '@/lib/editor/editable-manifest';

const compositionCode = `
  function Composition(props) {
    return (
      <div
        data-editable="title"
        style={{ position: 'absolute', left: 10, top: 20 }}
      >
        {props.title}
      </div>
    );
  }
`;

describe('editable transform ownership', () => {
  it('applies live-player transforms through the shared leaf owner', () => {
    const Component = evalRemotionJSX(compositionCode, {
      editableTransformMode: 'proxy',
    });
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html).toContain('translate:100px 50px');
  });

  it('keeps standalone export transforms on the same leaf owner', () => {
    const Component = evalRemotionJSX(compositionCode, {
      editableTransformMode: 'proxy',
    });
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html).toContain('translate:100px 50px');
  });

  it('never transforms a same-id ancestor around the real helper leaf', () => {
    const Component = evalRemotionJSX(`
      function EditableText({ id, value }) {
        return <span data-editable={id}>{value}</span>;
      }
      function Composition(props) {
        return (
          <div data-editable="title">
            <EditableText id="title" value={props.title} />
          </div>
        );
      }
    `);
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html.match(/translate:100px 50px/g)).toHaveLength(1);
    expect(html).toContain('<div data-editable="title"><span data-editable="title" style="translate:100px 50px">');
  });

  it('follows legacy fieldId props through an indirect scene helper', () => {
    const Component = evalRemotionJSX(`
      function FadeText({ id, children }) {
        return <span data-editable={id}>{children}</span>;
      }
      function FilmScene({ titleId, title }) {
        return <FadeText id={titleId}>{title}</FadeText>;
      }
      function Composition(props) {
        return (
          <div data-editable="title">
            <FilmScene titleId="title" title={props.title} />
          </div>
        );
      }
    `);
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html.match(/translate:100px 50px/g)).toHaveLength(1);
    expect(html).toContain('<div data-editable="title"><span data-editable="title" style="translate:100px 50px">');
  });

  it('applies inferred trim overrides directly to a video host', () => {
    const Component = evalRemotionJSX(`
      function Composition(props) {
        return <Video data-editable="clip" src={props.clip} trimBefore={5} />;
      }
    `);
    if (!Component) throw new Error('Expected composition to compile');

    const wrappedElement = (Component as unknown as (
      props: Record<string, unknown>,
    ) => React.ReactElement<Record<string, unknown>>)({
      clip: 'https://example.com/clip.mp4',
      _trimBefore_clip: 30,
      _trimAfter_clip: 180,
    });
    const renderedElement = (wrappedElement.type as (
      props: Record<string, unknown>,
    ) => React.ReactElement<Record<string, unknown>>)(wrappedElement.props);

    expect(renderedElement.props.trimBefore).toBe(30);
    expect(renderedElement.props.trimAfter).toBe(180);
    expect(renderedElement.props.className).toContain('makaron-editable-node');
    expect(renderedElement.props.className).toContain('makaron-editable-id-clip');
  });

  it('replaces compiler-lifted literal text in preview and export runtime', () => {
    const props: Record<string, unknown> = {};
    const manifest = compileEditableManifest({
      code: `
        function Label({ text }) {
          return <p>{text}</p>;
        }
        function Composition(props) {
          return <Label text="Hardcoded subtitle" />;
        }
      `,
      props,
    });
    const field = manifest.editables.find(item => item.source === 'literal');
    expect(field).toBeDefined();
    if (!field) throw new Error('Expected a compiler-lifted literal field');

    const Component = evalRemotionJSX(manifest.code);
    if (!Component) throw new Error('Expected composition to compile');
    const html = renderToStaticMarkup(
      <Component {...props} {...{ [field.propKey]: 'Edited subtitle' }} />,
    );

    expect(html).toContain('Edited subtitle');
    expect(html).not.toContain('Hardcoded subtitle');
  });

  it('replaces the selected literal from a rendered scene data array', () => {
    const props: Record<string, unknown> = {};
    const manifest = compileEditableManifest({
      code: `
        const scenes = [
          { id: 'opening', title: 'Original opening' },
          { id: 'ending', title: 'Original ending' },
        ];
        function Composition(props) {
          return <div>{scenes.map(scene => <h2>{scene.title}</h2>)}</div>;
        }
      `,
      props,
    });
    const Component = evalRemotionJSX(manifest.code);
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component {...props} openingTitle="Edited opening" />,
    );

    expect(html).toContain('Edited opening');
    expect(html).toContain('Original ending');
    expect(html).not.toContain('Original opening');
  });

  it('replaces the active compiler-lifted conditional text branch', () => {
    const props: Record<string, unknown> = {};
    const manifest = compileEditableManifest({
      code: `
        function Scene({ phase }) {
          return <span>{phase === 0 ? 'DAWN' : 'NIGHT'}</span>;
        }
        function Composition(props) {
          return <Scene phase={1} />;
        }
      `,
      props,
    });
    const Component = evalRemotionJSX(manifest.code);
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component {...props} sceneText2="Edited night" />,
    );

    expect(html).toContain('Edited night');
    expect(html).not.toContain('NIGHT');
  });

  it('replaces compiler-lifted primitive map entries independently', () => {
    const props: Record<string, unknown> = {};
    const manifest = compileEditableManifest({
      code: `
        const labels = ['First', 'Second'];
        function Composition(props) {
          return <div>{labels.map((label, index) => <span>{label}</span>)}</div>;
        }
      `,
      props,
    });
    const Component = evalRemotionJSX(manifest.code);
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component {...props} label2="Edited second" />,
    );

    expect(html).toContain('First');
    expect(html).toContain('Edited second');
    expect(html).not.toContain('Second');
  });
});
