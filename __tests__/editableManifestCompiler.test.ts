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

  it('infers text through multiple ordinary React helper layers', () => {
    const props: Record<string, unknown> = {
      title: 'Chang’an',
      opening: 'An eternal capital',
      chapter1: 'The rivers embrace Chang’an',
    };
    const result = compileEditableManifest({
      code: `
        function BrushTitle({ text, sub }) {
          return (
            <div>
              <div>{text}</div>
              {sub && <div>{sub}</div>}
            </div>
          );
        }
        function IntroScene({ title, opening }) {
          return (
            <AbsoluteFill>
              <BrushTitle text={title} sub={opening} />
            </AbsoluteFill>
          );
        }
        function ChapterScene({ title }) {
          return <BrushTitle text={title} sub="A hardcoded caption" />;
        }
        function Composition(props) {
          return (
            <AbsoluteFill>
              <Sequence>
                <IntroScene title={props.title} opening={props.opening} />
              </Sequence>
              <Sequence>
                <ChapterScene title={props.chapter1} />
              </Sequence>
            </AbsoluteFill>
          );
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      { id: 'chapter1', type: 'text', label: 'Chapter 1', propKey: 'chapter1' },
      {
        id: 'chapterSceneSubtitle',
        type: 'text',
        label: 'Chapter scene subtitle',
        propKey: 'chapterSceneSubtitle',
        source: 'literal',
      },
      { id: 'opening', type: 'text', label: 'Opening', propKey: 'opening' },
    ]);
    expect(props.chapterSceneSubtitle).toBe('A hardcoded caption');
    expect(result.code).toContain('data-editable={__makaronEditable_text}');
    expect(result.code).toContain(
      '__makaronEditable_text={__makaronEditable_title}',
    );
    expect(result.code).toContain('__makaronEditable_title="title"');
    expect(result.code).toContain('__makaronEditable_title="chapter1"');
    expect(result.code).toContain(
      '__makaronEditable_sub={__makaronEditable_opening}',
    );
    expect(result.code).toContain('__makaronEditable_opening="opening"');
    expect(result.code).toContain(
      '__makaronEditable_sub="chapterSceneSubtitle"',
    );

    expect(compileEditableManifest({
      code: result.code,
      props,
      editables: result.editables,
    })).toEqual(result);
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

  it('auto-lifts direct JSX literals and const strings into editable props', () => {
    const props: Record<string, unknown> = {};
    const result = compileEditableManifest({
      code: `
        const EYEBROW = 'HISTORY / 01';
        function Composition(props) {
          return (
            <div>
              <h1>Chang'an</h1>
              <p>{EYEBROW}</p>
            </div>
          );
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      {
        id: 'compositionTitle',
        type: 'text',
        label: 'Composition title',
        propKey: 'compositionTitle',
        source: 'literal',
      },
      {
        id: 'compositionParagraph',
        type: 'text',
        label: 'Composition paragraph',
        propKey: 'compositionParagraph',
        source: 'literal',
      },
    ]);
    expect(props).toMatchObject({
      compositionTitle: "Chang'an",
      compositionParagraph: 'HISTORY / 01',
    });
    expect(result.coverage).toEqual({
      visibleSinks: 2,
      editable: 2,
      ignored: 0,
      unsupported: [],
    });
  });

  it('auto-lifts hardcoded text from rendered scene data arrays', () => {
    const props: Record<string, unknown> = {};
    const result = compileEditableManifest({
      code: `
        const scenes = [
          { id: 'opening', title: 'The rivers embrace Chang’an' },
          { id: 'silk-road', title: 'The world meets here' },
        ];
        function Composition(props) {
          return (
            <div>
              {scenes.map(scene => <h2 key={scene.id}>{scene.title}</h2>)}
            </div>
          );
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([
      {
        id: 'openingTitle',
        type: 'text',
        label: 'Opening title',
        propKey: 'openingTitle',
        source: 'literal',
      },
      {
        id: 'silkRoadTitle',
        type: 'text',
        label: 'Silk road title',
        propKey: 'silkRoadTitle',
        source: 'literal',
      },
    ]);
    expect(props).toMatchObject({
      openingTitle: 'The rivers embrace Chang’an',
      silkRoadTitle: 'The world meets here',
    });
    expect(result.code).toContain(
      'data-editable={scene.__makaronEditable_title}',
    );
    expect(result.code).toContain(
      '__makaronEditable_title: "openingTitle"',
    );
    expect(result.code).toContain(
      '__makaronEditable_title: "silkRoadTitle"',
    );
  });

  it('supports an explicit ignore for intentionally fixed UI chrome', () => {
    const props: Record<string, unknown> = {};
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return <small data-editable-ignore>00:30</small>;
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual([]);
    expect(props).toEqual({});
    expect(result.coverage).toEqual({
      visibleSinks: 1,
      editable: 0,
      ignored: 1,
      unsupported: [],
    });
  });

  it('auto-lifts literal branches from runtime conditional text', () => {
    const props: Record<string, unknown> = {};
    const first = compileEditableManifest({
      code: `
        function Scene({ phase }) {
          return <span>{phase === 0 ? 'DAWN' : phase === 1 ? 'NOON' : 'NIGHT'}</span>;
        }
        function Composition(props) {
          return <Scene phase={1} />;
        }
      `,
      props,
    });

    expect(first.diagnostics).toEqual([]);
    expect(first.editables).toEqual([
      {
        id: 'sceneText',
        type: 'text',
        label: 'Scene text',
        propKey: 'sceneText',
        source: 'literal',
      },
      {
        id: 'sceneText2',
        type: 'text',
        label: 'Scene text 2',
        propKey: 'sceneText2',
        source: 'literal',
      },
      {
        id: 'sceneText3',
        type: 'text',
        label: 'Scene text 3',
        propKey: 'sceneText3',
        source: 'literal',
      },
    ]);
    expect(props).toMatchObject({
      sceneText: 'DAWN',
      sceneText2: 'NOON',
      sceneText3: 'NIGHT',
    });
    expect(first.code).toContain(
      'data-editable={phase === 0 ? "sceneText" : phase === 1 ? "sceneText2" : "sceneText3"}',
    );
    expect(compileEditableManifest({
      code: first.code,
      props,
      editables: first.editables,
    })).toEqual(first);
  });

  it('auto-lifts primitive labels rendered through map', () => {
    const props: Record<string, unknown> = {};
    const first = compileEditableManifest({
      code: `
        const featureLabels = ['Fast', 'Editable', 'Exportable'];
        function Composition(props) {
          return (
            <div>
              {featureLabels.map((label, index) => <span key={label}>{label}</span>)}
            </div>
          );
        }
      `,
      props,
    });

    expect(first.diagnostics).toEqual([]);
    expect(first.editables.map(field => field.id)).toEqual([
      'featureLabel1',
      'featureLabel2',
      'featureLabel3',
    ]);
    expect(props).toMatchObject({
      featureLabel1: 'Fast',
      featureLabel2: 'Editable',
      featureLabel3: 'Exportable',
    });
    expect(first.code).toContain(
      'data-editable={index === 0 ? "featureLabel1" : index === 1 ? "featureLabel2" : "featureLabel3"}',
    );
    expect(compileEditableManifest({
      code: first.code,
      props,
      editables: first.editables,
    })).toEqual(first);
  });

  it('auto-lifts primitive labels from a props collection', () => {
    const props: Record<string, unknown> = {
      labels: ['One', 'Two'],
    };
    const result = compileEditableManifest({
      code: `
        function Composition(props) {
          return (
            <div>
              {props.labels.map((label, index) => <small>{label}</small>)}
            </div>
          );
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables.map(field => field.id)).toEqual([
      'label1',
      'label2',
    ]);
    expect(props).toMatchObject({
      label1: 'One',
      label2: 'Two',
    });
  });

  it('does not count children layout wrappers as visible text sinks', () => {
    const props: Record<string, unknown> = {
      title: 'Visible title',
    };
    const result = compileEditableManifest({
      code: `
        function SceneShell({ children }) {
          return <div style={{ position: 'absolute' }}>{children}</div>;
        }
        function Composition(props) {
          return <SceneShell><h1>{props.title}</h1></SceneShell>;
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables.map(field => field.id)).toEqual(['title']);
    expect(result.coverage).toEqual({
      visibleSinks: 1,
      editable: 1,
      ignored: 0,
      unsupported: [],
    });
  });

  it('does not count visible leaves inside an unused helper', () => {
    const props: Record<string, unknown> = {
      title: 'Visible title',
    };
    const result = compileEditableManifest({
      code: `
        function UnusedLabel({ text }) {
          return <div>{text}</div>;
        }
        function Composition(props) {
          return <h1>{props.title}</h1>;
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables.map(field => field.id)).toEqual(['title']);
    expect(result.coverage).toEqual({
      visibleSinks: 1,
      editable: 1,
      ignored: 0,
      unsupported: [],
    });
  });

  it('keeps a complete legacy manifest without forcing helper rewrites', () => {
    const props: Record<string, unknown> = {
      title: 'Legacy title',
    };
    const editables = [{
      id: 'title',
      type: 'text' as const,
      label: 'Title',
      propKey: 'title',
    }];
    const result = compileEditableManifest({
      code: `
        function BigText({ id, value }) {
          return <div data-editable={id}>{value}</div>;
        }
        function Scene({ p, alternate }) {
          const id = alternate ? 'otherTitle' : 'title';
          const value = alternate ? p.otherTitle : p.title;
          return <BigText id={id} value={value} />;
        }
        function Composition(props) {
          return (
            <>
              <BigText id="title" value={props.title} />
              <Scene p={props} alternate={false} />
            </>
          );
        }
      `,
      props,
      editables,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.editables).toEqual(editables);
    expect(result.coverage.unsupported).toEqual([]);
  });
});
