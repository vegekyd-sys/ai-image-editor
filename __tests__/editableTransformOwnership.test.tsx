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
  it('leaves live-player transforms to the scene registry', () => {
    const Component = evalRemotionJSX(compositionCode, {
      editableTransformMode: 'registry',
    });
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html).not.toContain('translate:100px 50px');
  });

  it('does not apply transforms through the legacy React proxy', () => {
    const Component = evalRemotionJSX(compositionCode, {
      editableTransformMode: 'proxy',
    });
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(
      <Component title="Hello" _pos_title={{ x: 100, y: 50 }} />,
    );

    expect(html).not.toContain('translate:100px 50px');
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
  });
});
