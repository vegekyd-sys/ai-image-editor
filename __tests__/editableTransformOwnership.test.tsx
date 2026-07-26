import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';

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
});
