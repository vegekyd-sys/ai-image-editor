import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileEditableManifestWithProvenance } from '@/lib/editor/editable-provenance-compiler';
import { compileDynamicDesignComponent } from '@/remotion/DynamicDesign';

function compileForRender(
  code: string,
  props: Record<string, unknown>,
) {
  const manifest = compileEditableManifestWithProvenance({ code, props });
  const Component = compileDynamicDesignComponent(
    manifest.code,
    { React, Video: 'video', Img: 'img' },
  );
  expect(Component).not.toBeNull();
  if (!Component) throw new Error('Expected provenance composition to compile');
  return { Component, manifest };
}

describe('Editable provenance runtime integration', () => {
  it('makes computed-key captions selectable, movable, and scalable', () => {
    const props: Record<string, unknown> = {
      openingEn: 'Opening EN',
      drillingEn: 'Drilling EN',
    };
    const { Component, manifest } = compileForRender(`
      const cues = [
        { enKey: 'openingEn' },
        { enKey: 'drillingEn' },
      ];
      function Caption({ en }) {
        return <div>{en}</div>;
      }
      function Composition(props) {
        const textMap = {
          openingEn: props.openingEn,
          drillingEn: props.drillingEn,
        };
        return <section>{cues.map(function (cue) {
          return <Caption key={cue.enKey} en={textMap[cue.enKey]} />;
        })}</section>;
      }
    `, props);

    expect(manifest.diagnostics).toEqual([]);
    expect(manifest.editables.map(field => field.id)).toEqual([
      'openingEn',
      'drillingEn',
    ]);
    expect(manifest.code).toContain('data-editable');

    const html = renderToStaticMarkup(
      <Component
        {...props}
        _pos_openingEn={{ x: 120, y: -40 }}
        _scale_openingEn={{ w: 1.25, h: 1.25 }}
        _pos_drillingEn={{ x: -80, y: 60 }}
        _scale_drillingEn={{ w: 0.9, h: 0.9 }}
      />,
    );

    expect(html).toContain('data-editable="openingEn"');
    expect(html).toContain('translate:120px -40px');
    expect(html).toContain('scale:1.25 1.25');
    expect(html).toContain('data-editable="drillingEn"');
    expect(html).toContain('translate:-80px 60px');
    expect(html).toContain('scale:0.9 0.9');
  });

  it('keeps nested array aliases editable after their override changes', () => {
    const props: Record<string, unknown> = {
      words: ['one', 'two'],
    };
    const { Component, manifest } = compileForRender(`
      function Word({ value }) { return <span>WORD: {value}</span>; }
      function Composition(props) {
        return <div>{props.words.map(word => <Word key={word} value={word} />)}</div>;
      }
    `, props);

    expect(manifest.editables.map(field => field.id)).toEqual(['word1', 'word2']);
    expect(manifest.code).toContain('React.__makaronEditableId(value');
    expect(props.word1).toBe('one');
    expect(props.word2).toBe('two');

    const html = renderToStaticMarkup(
      <Component
        {...props}
        word1="ONE EDITED"
        _pos_word1={{ x: 50, y: 25 }}
        _scale_word1={{ w: 1.5, h: 1.5 }}
      />,
    );

    expect(html).toContain('data-editable="word1"');
    expect(html).toContain('WORD: ONE EDITED');
    expect(html).toContain('translate:50px 25px');
    expect(html).toContain('scale:1.5 1.5');
    expect(html).toContain('data-editable="word2"');
  });

  it('exposes the provenance id helper through namespace React imports', () => {
    const props: Record<string, unknown> = {
      words: ['one', 'two'],
    };
    const { Component, manifest } = compileForRender(`
      import * as React from 'react';
      function Word({ value }) { return <span>{value}</span>; }
      function Composition(props) {
        return <div>{props.words.map(value => <Word key={value} value={value} />)}</div>;
      }
    `, props);

    expect(manifest.code).toContain('React.__makaronEditableId(value');
    const html = renderToStaticMarkup(<Component {...props} />);
    expect(html).toContain('data-editable="word1"');
    expect(html).toContain('data-editable="word2"');
  });

  it('applies the same move and scale contract to provenance media nodes', () => {
    const props: Record<string, unknown> = {
      clips: ['https://example.com/one.mp4', 'https://example.com/two.mp4'],
    };
    const { Component, manifest } = compileForRender(`
      function Clip({ src }) { return <Video src={src} />; }
      function Composition(props) {
        return <div>{props.clips.map(src => <Clip key={src} src={src} />)}</div>;
      }
    `, props);

    expect(manifest.editables.map(field => [field.id, field.type])).toEqual([
      ['clip1', 'video'],
      ['clip2', 'video'],
    ]);

    const html = renderToStaticMarkup(
      <Component
        {...props}
        clip1="https://example.com/edited.mp4"
        _pos_clip1={{ x: 20, y: 30 }}
        _scale_clip1={{ w: 1.2, h: 1.2 }}
      />,
    );

    expect(html).toContain('data-editable="clip1"');
    expect(html).toContain('src="https://example.com/edited.mp4"');
    expect(html).toContain('translate:20px 30px');
    expect(html).toContain('scale:1.2 1.2');
    expect(html).toContain('data-editable="clip2"');
  });

  it('does not let one static marker replace every source in a reusable media helper', () => {
    const props = {
      strings: 'https://example.com/strings.mp4',
      paint: 'https://example.com/paint.mp4',
    };
    const Component = compileDynamicDesignComponent(`
      function Clip({ src }) {
        return <Video data-editable="strings" src={src} />;
      }
      function Composition(props) {
        const segments = [props.strings, props.paint];
        return <div>{segments.map(src => <Clip key={src} src={src} />)}</div>;
      }
    `, { React, Video: 'video', Img: 'img' });
    expect(Component).not.toBeNull();
    if (!Component) throw new Error('Expected composition to compile');

    const html = renderToStaticMarkup(<Component {...props} />);

    expect(html).toContain('src="https://example.com/strings.mp4"');
    expect(html).toContain('src="https://example.com/paint.mp4"');
    expect(html.match(/data-editable="strings"/g)).toHaveLength(1);
  });

  it('aggregates split/map word styling into one sentence editable', () => {
    const props = {
      caption: 'One editable sentence across styled words',
    };
    const { Component, manifest } = compileForRender(`
      function Caption({ sentence }) {
        return (
          <div>
            {sentence.split(' ').map((word, index) => (
              <span key={index} style={{ color: index === 1 ? 'pink' : 'white' }}>
                {word}{' '}
              </span>
            ))}
          </div>
        );
      }
      function Composition(props) {
        return <Caption sentence={props.caption} />;
      }
    `, props);

    expect(manifest.editables.map(field => [field.id, field.type])).toEqual([
      ['caption', 'text'],
    ]);
    expect(manifest.code.match(/data-editable="caption"/g)).toHaveLength(1);

    const html = renderToStaticMarkup(
      <Component
        {...props}
        caption="Edited sentence keeps word styling"
        _pos_caption={{ x: 12, y: 18 }}
      />,
    );

    expect(html).toContain('data-editable="caption"');
    expect(html).toContain('Edited');
    expect(html).toContain('word ');
    expect(html).toContain('styling ');
    expect(html).toContain('translate:12px 18px');
    expect(html.match(/data-editable="caption"/g)).toHaveLength(1);
  });

  it('keeps emphasized dynamic caption fragments out of the editable manifest', () => {
    const props: Record<string, unknown> = {
      cues: [
        { from: 0, to: 30, text: '脑子里有个画面｜特别想做出来' },
        { from: 30, to: 60, text: '几分钟｜就能出好版' },
      ],
    };
    const { Component, manifest } = compileForRender(`
      function Caption({ cue }) {
        const parts = cue.text.split('｜');
        return <div><span>{parts[0]}</span>{parts[1] && <strong>{parts[1]}</strong>}</div>;
      }
      function Composition(props) {
        return <section>{props.cues.map(cue => <Caption key={cue.from} cue={cue} />)}</section>;
      }
    `, props);

    expect(manifest.diagnostics).toEqual([]);
    expect(manifest.coverage.unsupported).toEqual([]);
    expect(manifest.editables).toEqual([]);
    expect(manifest.coverage.ignored).toBe(1);
    expect(manifest.code.match(/data-editable-ignore/g)).toHaveLength(1);

    const html = renderToStaticMarkup(<Component {...props} />);
    expect(html).toContain('脑子里有个画面');
    expect(html).toContain('特别想做出来');
    expect(html).toContain('几分钟');
    expect(html).toContain('就能出好版');
  });
});
