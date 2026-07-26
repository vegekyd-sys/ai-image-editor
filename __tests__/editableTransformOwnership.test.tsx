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

  it('keeps legacy proxy transforms for standalone export rendering', () => {
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
});
