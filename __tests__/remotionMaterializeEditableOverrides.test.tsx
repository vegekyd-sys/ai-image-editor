import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { compileDynamicDesignComponent } from '@/remotion/DynamicDesign';

describe('Remotion materialize editable overrides', () => {
  it('renders escaped and real newlines as line breaks instead of visible \\n text', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const Composition = () => runtime.React.createElement(
      'div',
      null,
      'CONTROL\\nTHE FLOW',
      runtime.React.createElement('span', null, 'Line one\nLine two'),
    );
    const MaterializedComposition = runtime.wrap(Composition, 'proxy');

    const html = renderToStaticMarkup(<MaterializedComposition />);

    expect(html).toContain('CONTROL<br/>THE FLOW');
    expect(html).toContain('Line one<br/>Line two');
    expect(html).not.toContain('\\n');
  });

  it('normalizes editable text overrides at the same shared render boundary', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const Composition = () => runtime.React.createElement(
      'div',
      { 'data-editable': 'title' },
      'Original',
    );
    const MaterializedComposition = runtime.wrap(Composition, 'proxy');

    const html = renderToStaticMarkup(
      <MaterializedComposition title={'First\\nSecond'} />,
    );

    expect(html).toContain('First<br/>Second');
    expect(html).not.toContain('First\\nSecond');
  });

  it('renders cloned inline caption backing as one stable Preview/export block', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const Composition = () => runtime.React.createElement(
      'div',
      {
        style: {
          display: 'inline',
          backgroundColor: 'rgba(13,12,13,.72)',
          boxShadow: '0 0 0 14px rgba(13,12,13,.72)',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        },
      },
      'Before it wins a rally, a badminton racket survives a tiny factory Olympics.',
    );
    const MaterializedComposition = runtime.wrap(Composition, 'proxy');

    const html = renderToStaticMarkup(<MaterializedComposition />);

    expect(html).toContain('display:inline-block');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('box-sizing:border-box');
    expect(html).toContain('box-decoration-break:slice');
    expect(html).toContain('-webkit-box-decoration-break:slice');
    expect(html).toContain('box-shadow:0 0 0 14px rgba(13,12,13,.72)');
  });

  it('does not rewrite ordinary inline emphasis without a cloned backing', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const Composition = () => runtime.React.createElement(
      'span',
      { style: { display: 'inline', color: '#ffcd3c' } },
      'factory Olympics',
    );
    const MaterializedComposition = runtime.wrap(Composition, 'proxy');

    const html = renderToStaticMarkup(<MaterializedComposition />);

    expect(html).toContain('display:inline');
    expect(html).not.toContain('display:inline-block');
  });

  it('applies persisted position and scale in the shared render runtime', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const Composition = (props: Record<string, unknown>) => runtime.React.createElement(
      'div',
      {
        'data-editable': 'title',
        style: { position: 'absolute', left: 10, top: 20 },
      },
      props.title as string,
    );
    const MaterializedComposition = runtime.wrap(Composition, 'proxy');

    const html = renderToStaticMarkup(
      <MaterializedComposition
        title="Moved title"
        _pos_title={{ x: 240, y: -80 }}
        _scale_title={{ w: 1.4, h: 1.2 }}
      />,
    );

    expect(html).toContain('translate:240px -80px');
    expect(html).toContain('scale:1.4 1.2');
  });

  it('applies the same overrides through the actual DynamicDesign compiler', () => {
    const Component = compileDynamicDesignComponent(
      `
        function Composition(props) {
          return (
            <div data-editable="title">
              {props.title}
            </div>
          );
        }
      `,
      { React, Video: 'video' },
    );
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected DynamicDesign to compile');

    const html = renderToStaticMarkup(
      <Component
        title="Materialized title"
        _pos_title={{ x: -120, y: 360 }}
        _scale_title={{ w: 0.8, h: 0.8 }}
      />,
    );

    expect(html).toContain('translate:-120px 360px');
    expect(html).toContain('scale:0.8 0.8');
  });
});
