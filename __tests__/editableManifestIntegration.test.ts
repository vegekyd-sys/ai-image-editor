import { describe, expect, it } from 'vitest';
import { validateDesign, type DesignResult } from '@/lib/design-harness';

describe('Editable Manifest harness integration', () => {
  it('normalizes natural React into a persisted editable composition', () => {
    const result: DesignResult = {
      code: `
        function Composition(props) {
          return (
            <AbsoluteFill>
              <h1>{props.title}</h1>
              <Img src={props.heroImage} />
              <Video src={props.clip} />
            </AbsoluteFill>
          );
        }
      `,
      props: {
        title: 'Hello',
        heroImage: 'https://example.com/hero.jpg',
        clip: 'https://example.com/clip.mp4',
      },
      animation: { fps: 30, durationInSeconds: 10 },
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.code).toContain('data-editable="title"');
    expect(result.code).toContain('data-editable="heroImage"');
    expect(result.code).toContain('data-editable="clip"');
    expect(result.editables?.map(field => [field.id, field.type])).toEqual([
      ['title', 'text'],
      ['heroImage', 'image'],
      ['clip', 'video'],
    ]);
  });

  it('accepts an explicit dynamic runtime id without a metadata array', () => {
    const result: DesignResult = {
      code: `
        const scenes = [{ titleKey: 'title0' }, { titleKey: 'title1' }];
        function Composition(props) {
          const scene = scenes[0];
          return <h1 data-editable={scene.titleKey}>{props[scene.titleKey]}</h1>;
        }
      `,
      props: { title0: 'One', title1: 'Two' },
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.editables?.map(field => field.id)).toEqual(['title0', 'title1']);
  });

  it('persists editables from reusable scene components without agent metadata', () => {
    const result: DesignResult = {
      code: `
        function Chapter({ year, title, description }) {
          return (
            <section>
              <div>{year}</div>
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
              />
              <Chapter
                year={props.yearTwo}
                title={props.titleTwo}
                description={props.descriptionTwo}
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
      animation: { fps: 30, durationInSeconds: 6 },
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.editables?.map(field => field.id)).toEqual([
      'yearOne',
      'yearTwo',
      'titleOne',
      'titleTwo',
      'descriptionOne',
      'descriptionTwo',
    ]);
    expect(result.code).toContain('data-editable={__makaronEditable_title}');
    expect(result.code).toContain('__makaronEditable_title="titleTwo"');
  });

  it('revalidates persisted multi-source media helpers without asking for a repair', () => {
    const first: DesignResult = {
      code: `
        function Clip({ src }) {
          return <Video src={src} />;
        }
        function Composition(props) {
          const clips = { strings: props.strings, paint: props.paint };
          const segments = [
            { src: clips.strings },
            { src: clips.paint },
          ];
          return (
            <AbsoluteFill>
              {segments.map((segment, index) => (
                <Clip key={index} src={segment.src} />
              ))}
            </AbsoluteFill>
          );
        }
      `,
      props: {
        strings: 'https://example.com/strings.mp4',
        paint: 'https://example.com/paint.mp4',
      },
      animation: { fps: 30, durationInSeconds: 10 },
    };

    expect(validateDesign(first)).toBeNull();
    expect(first.editables?.map(field => field.id).sort()).toEqual([
      'paint',
      'strings',
    ]);
    expect(first.code).toContain('React.__makaronEditableId(src');

    const persisted = JSON.parse(JSON.stringify(first)) as DesignResult;
    expect(validateDesign(persisted)).toBeNull();
    expect(persisted.editables?.map(field => field.id).sort()).toEqual([
      'paint',
      'strings',
    ]);
    expect(persisted.editables?.some(field => field.id.startsWith('https://'))).toBe(false);
    expect(persisted.code).toBe(first.code);
  });

  it('replaces an unsafe static media-helper marker with inferred per-source ownership', () => {
    const result: DesignResult = {
      code: `
        function Clip({ src }) {
          return <Video data-editable="strings" src={src} />;
        }
        function Composition(props) {
          const clips = { strings: props.strings, paint: props.paint };
          const segments = [{ src: clips.strings }, { src: clips.paint }];
          return segments.map((segment, index) => (
            <Clip key={index} src={segment.src} />
          ));
        }
      `,
      props: {
        strings: 'https://example.com/strings.mp4',
        paint: 'https://example.com/paint.mp4',
      },
      editables: [
        { id: 'strings', type: 'video', label: 'Strings', propKey: 'strings' },
      ],
      animation: { fps: 30, durationInSeconds: 10 },
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.code).not.toContain('data-editable="strings" src={src}');
    expect(result.code).toContain('React.__makaronEditableId(src');
    expect(result.editables?.map(field => field.id).sort()).toEqual([
      'paint',
      'strings',
    ]);
  });

  it('auto-lifts visible hardcoded text with no authored prop ownership', () => {
    const result: DesignResult = {
      code: `
        function Composition() {
          return <h1>Hardcoded headline</h1>;
        }
      `,
      props: {},
    };

    expect(validateDesign(result)).toBeNull();
    expect(result.editables).toEqual([
      {
        id: 'compositionTitle',
        type: 'text',
        label: 'Composition title',
        propKey: 'compositionTitle',
        source: 'literal',
      },
    ]);
    expect(result.props?.compositionTitle).toBe('Hardcoded headline');
  });
});
