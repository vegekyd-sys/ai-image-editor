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

  it('drops stale explicit metadata that has no real JSX ownership', () => {
    const result = compileEditableManifest({
      code: `
        function TechText({ text, editableId }) {
          return <div data-editable={editableId}>{text}</div>;
        }
        function Composition(props) {
          return <TechText text={props.kicker} editableId="topLabel" />;
        }
      `,
      props: { kicker: 'FUTURE / 01' },
      editables: [
        { id: 'kicker', type: 'text', label: 'Kicker', propKey: 'kicker' },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'topLabel', type: 'text', label: 'Top label', propKey: 'kicker' },
    ]);
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

  it('infers editable leaves through an ordinary reusable React component', () => {
    const result = compileEditableManifest({
      code: `
        function Chapter({ year, title, description, accent }) {
          return (
            <section style={{ color: accent }}>
              <div className="year">{year}</div>
              <h1>{title}</h1>
              <p>{description}</p>
            </section>
          );
        }
        function Composition(props) {
          return (
            <AbsoluteFill>
              <Chapter
                year={props.yearOne}
                title={props.titleOne}
                description={props.descriptionOne}
                accent="#54D28D"
              />
              <Chapter
                year={props.yearTwo}
                title={props.titleTwo}
                description={props.descriptionTwo}
                accent="#79E0B0"
              />
            </AbsoluteFill>
          );
        }
      `,
      props: {
        yearOne: '2011',
        titleOne: 'Connect',
        descriptionOne: 'Every message arrives.',
        yearTwo: '2017',
        titleTwo: 'Mini Programs',
        descriptionTwo: 'Services within reach.',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'yearOne', type: 'text', label: 'Year one', propKey: 'yearOne' },
      { id: 'yearTwo', type: 'text', label: 'Year two', propKey: 'yearTwo' },
      { id: 'titleOne', type: 'text', label: 'Title one', propKey: 'titleOne' },
      { id: 'titleTwo', type: 'text', label: 'Title two', propKey: 'titleTwo' },
      {
        id: 'descriptionOne',
        type: 'text',
        label: 'Description one',
        propKey: 'descriptionOne',
      },
      {
        id: 'descriptionTwo',
        type: 'text',
        label: 'Description two',
        propKey: 'descriptionTwo',
      },
    ]);
    expect(result.code).toContain('data-editable={__makaronEditable_year}');
    expect(result.code).toContain('data-editable={__makaronEditable_title}');
    expect(result.code).toContain('data-editable={__makaronEditable_description}');
    expect(result.code).toContain('__makaronEditable_year="yearOne"');
    expect(result.code).toContain('__makaronEditable_title="titleTwo"');

    const second = compileEditableManifest({
      code: result.code,
      props: {
        yearOne: '2011',
        titleOne: 'Connect',
        descriptionOne: 'Every message arrives.',
        yearTwo: '2017',
        titleTwo: 'Mini Programs',
        descriptionTwo: 'Services within reach.',
      },
      editables: result.editables,
    });
    expect(second).toEqual(result);
  });

  it('infers media leaves through an ordinary reusable React component', () => {
    const result = compileEditableManifest({
      code: `
        function Scene({ image, clip }) {
          return (
            <div>
              <Img src={image} />
              <Video src={clip} />
            </div>
          );
        }
        function Composition(props) {
          return <Scene image={props.heroImage} clip={props.heroVideo} />;
        }
      `,
      props: {
        heroImage: 'https://example.com/hero.jpg',
        heroVideo: 'https://example.com/hero.mp4',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'heroImage', type: 'image', label: 'Hero image', propKey: 'heroImage' },
      { id: 'heroVideo', type: 'video', label: 'Hero video', propKey: 'heroVideo' },
    ]);
    expect(result.code).toContain('data-editable={__makaronEditable_image}');
    expect(result.code).toContain('data-editable={__makaronEditable_clip}');
  });

  it('infers a video leaf inside a mixed text and media layout helper', () => {
    const props = {
      title: 'WeChat growth moments',
      subtitle: 'From connection to intelligence',
      heroVideo: 'https://example.com/hero.mp4',
      momentLabel: 'MOMENT / 01',
      platformLabel: 'WECHAT',
    };
    const result = compileEditableManifest({
      code: `
        function IntroLayout({
          title,
          subtitle,
          videoUrl,
          momentLabel,
          platformLabel,
        }) {
          return (
            <AbsoluteFill>
              <div>
                <span>{momentLabel}</span>
                <h1>{title}</h1>
                <p>{subtitle}</p>
              </div>
              <div style={{ position: 'absolute', left: 68, top: 590, width: 944, height: 795 }}>
                <Video
                  src={videoUrl}
                  trimBefore={20}
                  trimAfter={200}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <div>{platformLabel}</div>
              </div>
            </AbsoluteFill>
          );
        }
        function Composition(props) {
          return (
            <IntroLayout
              title={props.title}
              subtitle={props.subtitle}
              videoUrl={props.heroVideo}
              momentLabel={props.momentLabel}
              platformLabel={props.platformLabel}
            />
          );
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toContainEqual({
      id: 'heroVideo',
      type: 'video',
      label: 'Hero video',
      propKey: 'heroVideo',
    });
    expect(result.code).toContain('data-editable={__makaronEditable_videoUrl}');
    expect(result.code).toContain('__makaronEditable_videoUrl="heroVideo"');
    expect(result.code).not.toMatch(/<Video[^>]+data-editable/);
    expect(result.editables).toHaveLength(5);
    expect(props).toMatchObject({
      _trimBefore_heroVideo: 20,
      _trimAfter_heroVideo: 200,
    });
  });

  it('migrates an old compiler marker from Video to its DOM owner box', () => {
    const props: Record<string, unknown> = {
      title: 'WeChat growth moments',
      heroVideo: 'https://example.com/hero.mp4',
    };
    const result = compileEditableManifest({
      code: `
        function IntroLayout({
          title,
          videoUrl,
          __makaronEditable_title,
          __makaronEditable_videoUrl,
        }) {
          return (
            <AbsoluteFill>
              <h1 data-editable={__makaronEditable_title}>{title}</h1>
              <div style={{ position: 'absolute', left: 68, top: 590, width: 944, height: 795 }}>
                <Video
                  src={videoUrl}
                  trimBefore={20}
                  trimAfter={200}
                  data-editable={__makaronEditable_videoUrl}
                />
              </div>
            </AbsoluteFill>
          );
        }
        function Composition(props) {
          return (
            <IntroLayout
              title={props.title}
              videoUrl={props.heroVideo}
              __makaronEditable_title="title"
              __makaronEditable_videoUrl="heroVideo"
            />
          );
        }
      `,
      props,
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
        { id: 'heroVideo', type: 'video', label: 'Hero video', propKey: 'heroVideo' },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toMatch(/<Video[^>]+data-editable/);
    expect(result.code).toMatch(/<div[^>]+data-editable=\{__makaronEditable_videoUrl\}/);
    expect(result.editables.map(field => field.id)).toEqual(['title', 'heroVideo']);
    expect(props).toMatchObject({
      _trimBefore_heroVideo: 20,
      _trimAfter_heroVideo: 200,
    });

    expect(compileEditableManifest({
      code: result.code,
      props,
      editables: result.editables,
    })).toEqual(result);
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
