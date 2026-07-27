import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { compileDynamicDesignComponent } from '@/remotion/DynamicDesign';

describe('Remotion materialize editable overrides', () => {
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
