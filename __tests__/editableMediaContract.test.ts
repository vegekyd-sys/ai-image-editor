import { describe, expect, it } from 'vitest';
import { validateDesign, validateDesignReport, type DesignResult } from '@/lib/design-harness';

describe('editable media contract', () => {
  it('accepts a generated Remotion composition with text, image, and trim-ready video editables', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="heroVideo"
              style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, display: 'block' }}
            >
              <Video
                src={props.heroVideo}
                trimBefore={props.heroStartFrame}
                trimAfter={props.heroEndFrame}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div
              data-editable="cover"
              style={{ position: 'absolute', left: 64, top: 108, width: 280, height: 360, display: 'block' }}
            >
              <Img src={props.coverImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.48))' }} />
            <div
              data-editable="title"
              style={{ position: 'absolute', left: 72, right: 72, bottom: 160, minHeight: 96, display: 'block' }}
            >
              {props.title}
            </div>
          </AbsoluteFill>
        );
      }`,
      props: {
        title: 'Launch day',
        coverImage: 'https://example.com/cover.jpg',
        heroVideo: 'https://example.com/clip.mp4',
        heroStartFrame: 30,
        heroEndFrame: 180,
      },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
        { id: 'cover', type: 'image', label: 'Cover image', propKey: 'coverImage' },
        {
          id: 'heroVideo',
          type: 'video',
          label: 'Hero video',
          propKey: 'heroVideo',
          trimBeforePropKey: 'heroStartFrame',
          trimAfterPropKey: 'heroEndFrame',
        },
      ],
    });

    expect(result).toBeNull();
  });

  it('accepts low-burden dynamic text editables that render from prop keys', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        const scenes = [
          { yearKey: 'year0', titleKey: 'title0', subtitleKey: 'subtitle0', badgeKey: 'badge0' },
          { yearKey: 'year1', titleKey: 'title1', subtitleKey: 'subtitle1', badgeKey: 'badge1' },
        ];
        function EditableText({ id, style }) {
          return (
            <div data-editable={id} style={{ display: 'block', ...style }}>
              {props[id]}
            </div>
          );
        }
        return (
          <AbsoluteFill>
            {scenes.map((scene, index) => (
              <Sequence key={index} from={index * 90} durationInFrames={90}>
                <EditableText id={scene.badgeKey} style={{ position: 'absolute', left: 48, top: 48, width: 160, height: 56 }} />
                <EditableText id={scene.yearKey} style={{ position: 'absolute', left: 64, top: 160, width: 240, height: 72 }} />
                <EditableText id={scene.titleKey} style={{ position: 'absolute', left: 64, top: 252, width: 760, height: 120 }} />
                <EditableText id={scene.subtitleKey} style={{ position: 'absolute', left: 64, top: 396, width: 720, height: 96 }} />
              </Sequence>
            ))}
          </AbsoluteFill>
        );
      }`,
      props: {
        year0: '2011',
        title0: '产品起点',
        subtitle0: '第一批用户开始使用',
        badge0: '01 / 02',
        year1: '2026',
        title1: '生态平台',
        subtitle1: '从工具走向社区',
        badge1: '02 / 02',
      },
      editables: [
        { id: 'year0', type: 'text', label: 'Year 1', propKey: 'year0' },
        { id: 'title0', type: 'text', label: 'Title 1', propKey: 'title0' },
        { id: 'subtitle0', type: 'text', label: 'Subtitle 1', propKey: 'subtitle0' },
        { id: 'badge0', type: 'text', label: 'Badge 1', propKey: 'badge0' },
        { id: 'year1', type: 'text', label: 'Year 2', propKey: 'year1' },
        { id: 'title1', type: 'text', label: 'Title 2', propKey: 'title1' },
        { id: 'subtitle1', type: 'text', label: 'Subtitle 2', propKey: 'subtitle1' },
        { id: 'badge1', type: 'text', label: 'Badge 2', propKey: 'badge1' },
      ],
    });

    expect(result).toBeNull();
  });

  it('accepts active-scene editable keys declared in props without expanding every scene', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        const scene = props.sceneData[Math.min(props.sceneData.length - 1, 0)];
        return (
          <AbsoluteFill>
            <div
              data-editable={scene.titleKey}
              style={{ position: 'absolute', left: 40, top: 80, width: 420, height: 90 }}
            >
              {props[scene.titleKey]}
            </div>
            <img
              data-editable={scene.imageKey}
              src={props[scene.imageKey]}
              style={{ position: 'absolute', left: 40, top: 200, width: 420, height: 260 }}
            />
          </AbsoluteFill>
        );
      }`,
      props: {
        sceneData: [
          { kind: 'hook', titleKey: 'title0', imageKey: 'image0' },
          { kind: 'festival', titleKey: 'title1', imageKey: 'image1' },
        ],
        title0: 'A visible title',
        image0: 'https://example.com/0.jpg',
        title1: 'Another visible title',
        image1: 'https://example.com/1.jpg',
      },
      editables: [
        { id: 'title0', type: 'text', label: 'Title 1', propKey: 'title0' },
        { id: 'image0', type: 'image', label: 'Image 1', propKey: 'image0' },
        { id: 'title1', type: 'text', label: 'Title 2', propKey: 'title1' },
        { id: 'image1', type: 'image', label: 'Image 2', propKey: 'image1' },
      ],
    });

    expect(result).toBeNull();
  });

  it('drops an unmeasurable active-scene field without blocking the composition', () => {
    const payload: DesignResult = {
      code: `function Composition(props) {
        const scene = props.sceneData[0];
        return (
          <AbsoluteFill>
            <div
              data-editable={scene.titleKey}
              style={{ position: 'absolute', left: 40, top: 80, width: 420, height: 90 }}
            >
              {props[scene.titleKey]}
            </div>
            <div data-editable={scene.imageKey}>
              <Img src={props[scene.imageKey]} />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: {
        sceneData: [{ titleKey: 'title0', imageKey: 'image0' }],
        title0: 'A visible title',
        image0: 'https://example.com/0.jpg',
      },
      editables: [
        { id: 'title0', type: 'text', label: 'Title', propKey: 'title0' },
        { id: 'image0', type: 'image', label: 'Image', propKey: 'image0' },
      ],
    };

    const report = validateDesignReport(payload);
    expect(report.blocking).toEqual([]);
    expect(report.advisories.join('\n')).toMatch(/image0|measurable wrapper/i);
    expect(payload.editables?.map(field => field.id)).toEqual(['title0']);
  });

  it('infers active-scene fields omitted from legacy editable metadata', () => {
    const payload: DesignResult = {
      code: `function Composition(props) {
        const scene = props.sceneData[0];
        return (
          <div
            data-editable={scene.titleKey}
            style={{ position: 'absolute', left: 40, top: 80, width: 420, height: 90 }}
          >
            {props[scene.titleKey]}
          </div>
        );
      }`,
      props: {
        sceneData: [{ titleKey: 'title0' }, { titleKey: 'title1' }],
        title0: 'A visible title',
        title1: 'Another visible title',
      },
      editables: [
        { id: 'title0', type: 'text', label: 'Title 1', propKey: 'title0' },
      ],
    } as Parameters<typeof validateDesign>[0];
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual(['title0', 'title1']);
  });

  it('ignores structural control tokens in rendered scene objects', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        const scenes = [
          { kind: 'hook', titleKey: 'title0' },
          { kind: 'glasto', titleKey: 'title1' },
          { kind: 'coachella', titleKey: 'title2' },
        ];
        const scene = scenes[0];
        return (
          <div data-editable={scene.titleKey}>
            {props[scene.titleKey]}
          </div>
        );
      }`,
      props: {
        title0: 'Hook title',
        title1: 'Glastonbury title',
        title2: 'Coachella title',
      },
      editables: [
        { id: 'title0', type: 'text', label: 'Title 1', propKey: 'title0' },
        { id: 'title1', type: 'text', label: 'Title 2', propKey: 'title1' },
        { id: 'title2', type: 'text', label: 'Title 3', propKey: 'title2' },
      ],
    });

    expect(result).toBeNull();
  });

  it('accepts dynamic image editables when the shared wrapper has a measurable box', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        const scenes = [
          { imageKey: 'imageCard0' },
          { imageKey: 'imageCard1' },
        ];
        return (
          <AbsoluteFill>
            {scenes.map((scene, index) => (
              <Sequence key={scene.imageKey} from={index * 90} durationInFrames={90}>
                <div
                  data-editable={scene.imageKey}
                  style={{ position: 'absolute', left: 80, top: 520, width: 520, height: 360, display: 'block' }}
                >
                  <Img src={props[scene.imageKey]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </Sequence>
            ))}
          </AbsoluteFill>
        );
      }`,
      props: {
        imageCard0: 'https://example.com/a.jpg',
        imageCard1: 'https://example.com/b.jpg',
      },
      editables: [
        { id: 'imageCard0', type: 'image', label: 'Image card 1', propKey: 'imageCard0' },
        { id: 'imageCard1', type: 'image', label: 'Image card 2', propKey: 'imageCard1' },
      ],
    });

    expect(result).toBeNull();
  });

  it('accepts image editables when the wrapper has a measurable box', () => {
    const result = validateDesign({
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="cover"
              style={{ position: 'absolute', left: 80, top: 120, width: 420, height: 520, display: 'block' }}
            >
              <Img src={props.coverImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: { coverImage: 'https://example.com/cover.jpg' },
      editables: [
        { id: 'cover', type: 'image', label: 'Cover image', propKey: 'coverImage' },
      ],
    });

    expect(result).toBeNull();
  });

  it('rejects inline data image URLs because they fail MP4 export', () => {
    const result = validateDesign({
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="cover"
              style={{ position: 'absolute', left: 80, top: 120, width: 420, height: 520, display: 'block' }}
            >
              <Img src={props.coverImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: { coverImage: 'data:image/svg+xml;base64,PHN2Zy8+' },
      editables: [
        { id: 'cover', type: 'image', label: 'Cover image', propKey: 'coverImage' },
      ],
    });

    expect(result).toEqual(expect.stringMatching(/data:image|export-safe|https/i));
  });

  it('accepts video editables with trim prop keys when the wrapper has a measurable box', () => {
    const result = validateDesign({
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="heroVideo"
              style={{ position: 'absolute', inset: 0, display: 'block' }}
            >
              <Video
                src={props.heroVideo}
                trimBefore={props.heroVideoStart}
                trimAfter={props.heroVideoEnd}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: {
        heroVideo: 'https://example.com/clip.mp4',
        heroVideoStart: 30,
        heroVideoEnd: 120,
      },
      editables: [
        {
          id: 'heroVideo',
          type: 'video',
          label: 'Hero video',
          propKey: 'heroVideo',
          trimBeforePropKey: 'heroVideoStart',
          trimAfterPropKey: 'heroVideoEnd',
        },
      ],
    });

    expect(result).toBeNull();
  });

  it('instruments editables that are declared but missing data-editable in JSX', () => {
    const payload = {
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div style={{ display: 'block' }}>{props.title}</div>
          </AbsoluteFill>
        );
      }`,
      props: { title: 'Launch day' },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      ],
    } as Parameters<typeof validateDesign>[0];
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.code).toContain('data-editable="title"');
  });

  it('infers metadata for explicit data-editable wrappers', () => {
    const payload = {
      code: `function Composition(props) {
        return (
          <AbsoluteFill>
            <div data-editable="title" style={{ display: 'block' }}>{props.title}</div>
          </AbsoluteFill>
        );
      }`,
      props: { title: 'Launch day' },
      editables: [],
    } as Parameters<typeof validateDesign>[0];
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual(['title']);
  });

  it('infers metadata for visible text props', () => {
    const payload = {
      code: `function Composition(props) {
        return (
          <AbsoluteFill>
            <h1>{props.title}</h1>
          </AbsoluteFill>
        );
      }`,
      props: { title: 'Launch day' },
      editables: [],
    } as Parameters<typeof validateDesign>[0];
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.code).toContain('data-editable="title"');
    expect(payload.editables?.map(field => field.id)).toEqual(['title']);
  });

  it('infers image metadata for visible image props', () => {
    const payload = {
      code: `function Composition(props) {
        return (
          <AbsoluteFill>
            <Img src={props.coverImage} style={{ width: '100%', height: '100%' }} />
          </AbsoluteFill>
        );
      }`,
      props: { coverImage: 'https://example.com/cover.jpg' },
      editables: [],
    } as Parameters<typeof validateDesign>[0];
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.code).toContain('data-editable="coverImage"');
    expect(payload.editables).toEqual([
      { id: 'coverImage', type: 'image', label: 'Cover image', propKey: 'coverImage' },
    ]);
  });

  it('keeps renderable text when editable ownership needs a fallback', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div data-editable="title" style={{ display: 'block' }}>Launch day</div>
          </AbsoluteFill>
        );
      }`,
      props: { title: 'Launch day' },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      ],
    };

    const report = validateDesignReport(payload);
    expect(report.blocking).toEqual([]);
    expect(report.advisories.join('\n')).toMatch(/props\.title|prop key|hardcoded/i);
  });

  it('auto-lifts hardcoded rendered text arrays alongside media editables', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        const names = ['Alice', 'Bob'];
        return (
          <AbsoluteFill>
            <div data-editable="photo1" style={{ width: 400, height: 300 }}>
              <Img src={props.photo1} />
            </div>
            <span>{names[0]}</span>
            <div data-editable="photo2" style={{ width: 400, height: 300 }}>
              <Img src={props.photo2} />
            </div>
            <span>{names[1]}</span>
          </AbsoluteFill>
        );
      }`,
      props: { photo1: 'https://example.com/a.jpg', photo2: 'https://example.com/b.jpg' },
      editables: [
        { id: 'photo1', type: 'image', label: 'Photo 1', propKey: 'photo1' },
        { id: 'photo2', type: 'image', label: 'Photo 2', propKey: 'photo2' },
      ],
    };
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual([
      'photo1',
      'photo2',
      'name1Text',
      'name2Text',
    ]);
    expect(payload.props).toMatchObject({
      name1Text: 'Alice',
      name2Text: 'Bob',
    });
  });

  it('auto-lifts rendered timeline object arrays alongside authored editables', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        const milestones = [
          { year: '2016', title: '短视频工具起步', desc: '人人都能拍一段生活' },
          { year: '2023', title: '创作者生态平台', desc: '直播、电商与内容协作成型' },
        ];
        return (
          <AbsoluteFill>
            {milestones.map((item, index) => (
              <section key={index}>
                <p>{item.year}</p>
                <h2>{item.title}</h2>
                <p>{item.desc}</p>
              </section>
            ))}
            <div
              data-editable="tagline"
              style={{ position: 'absolute', left: 80, top: 80, width: 520, height: 80 }}
            >
              {props.tagline}
            </div>
          </AbsoluteFill>
        );
      }`,
      props: { tagline: '记录每一次创作' },
      editables: [
        { id: 'tagline', type: 'text', label: 'Tagline', propKey: 'tagline' },
      ],
    };
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual([
      'tagline',
      'milestone1Year',
      'milestone2Year',
      'milestone1Title',
      'milestone2Title',
      'milestone1Description',
      'milestone2Description',
    ]);
  });

  it('auto-lifts selected scene object text with no authored editables', () => {
    const payload: DesignResult = {
      code: `const SCENES = [
        { id: 'intro', year: '', title: '小红书', subtitle: '一个关于生活的故事', bg: ['#FF2442', '#FF6B81'] },
        { id: 'y2013', year: '2013', title: '生活分享社区', subtitle: '用户自发分享真实生活', bg: ['#1A1A2E', '#16213E'] },
      ];
      function Design() {
        const scene = SCENES.find(item => item.id === 'intro') || SCENES[0];
        return (
          <AbsoluteFill>
            <h1>{scene.title}</h1>
            <p>{scene.subtitle}</p>
          </AbsoluteFill>
        );
      }`,
      props: {},
      editables: [],
    };
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual([
      'introTitle',
      'y2013Title',
      'introSubtitle',
      'y2013Subtitle',
    ]);
  });

  it('auto-lifts hardcoded JSX badges or stats alongside primary editables', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="title"
              style={{ position: 'absolute', left: 80, top: 120, width: 720, height: 120 }}
            >
              {props.title}
            </div>
            <div>MEITUAN</div>
            <span>01 / 05</span>
            <p>市占超60%</p>
          </AbsoluteFill>
        );
      }`,
      props: { title: '本地生活新纪元' },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      ],
    };
    const result = validateDesign(payload);

    expect(result).toBeNull();
    expect(payload.editables?.map(field => field.id)).toEqual([
      'title',
      'designText',
      'designText2',
      'designParagraph',
    ]);
    expect(payload.props).toMatchObject({
      designText: 'MEITUAN',
      designText2: '01 / 05',
      designParagraph: '市占超60%',
    });
  });

  it('does not treat tiny lowercase code-like tokens as visible hardcoded text', () => {
    const result = validateDesign({
      code: `function Design(props) {
        const dots = [0, 1, 2];
        return (
          <AbsoluteFill>
            <div
              data-editable="title"
              style={{ position: 'absolute', left: 80, top: 120, width: 720, height: 120 }}
            >
              {props.title}
            </div>
            {dots.map((i2) => (
              <span key={i2} style={{ opacity: i2 === 1 ? 1 : 0.4 }} />
            ))}
          </AbsoluteFill>
        );
      }`,
      props: { title: '产品发布会' },
      editables: [
        { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      ],
    });

    expect(result).toBeNull();
  });

  it('rejects multi-scene timelines that accidentally keep a one-second animation duration', () => {
    const result = validateDesign({
      code: `function Composition(props) {
        return (
          <AbsoluteFill>
            <Sequence from={0} durationInFrames={150}>
              <div data-editable="title0" style={{ display: 'block' }}>{props.title0}</div>
            </Sequence>
            <Sequence from={150} durationInFrames={150}>
              <div data-editable="title1" style={{ display: 'block' }}>{props.title1}</div>
            </Sequence>
          </AbsoluteFill>
        );
      }`,
      props: { title0: '第一幕', title1: '第二幕' },
      editables: [
        { id: 'title0', type: 'text', label: 'Title 1', propKey: 'title0' },
        { id: 'title1', type: 'text', label: 'Title 2', propKey: 'title1' },
      ],
      animation: { fps: 30, durationInSeconds: 1 },
    });

    expect(result).toEqual(expect.stringMatching(/durationInSeconds|1 second|30s|timeline duration/i));
  });

  it('drops image editables whose wrapper cannot be measured by Moveable', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div data-editable="cover">
              <Img src={props.coverImage} style={{ position: 'absolute', inset: 0, objectFit: 'cover' }} />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: { coverImage: 'https://example.com/cover.jpg' },
      editables: [
        { id: 'cover', type: 'image', label: 'Cover image', propKey: 'coverImage' },
      ],
    };

    const report = validateDesignReport(payload);
    expect(report.blocking).toEqual([]);
    expect(report.advisories.join('\n')).toMatch(/measurable|width|height|inset|box/i);
    expect(payload.editables).toEqual([]);
  });

  it('drops unwired trim metadata without blocking the video composition', () => {
    const payload: DesignResult = {
      code: `function Design(props) {
        return (
          <AbsoluteFill>
            <div
              data-editable="heroVideo"
              style={{ position: 'absolute', inset: 0, display: 'block' }}
            >
              <Video
                src={props.heroVideo}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          </AbsoluteFill>
        );
      }`,
      props: {
        heroVideo: 'https://example.com/clip.mp4',
        heroVideoStart: 30,
        heroVideoEnd: 120,
      },
      editables: [
        {
          id: 'heroVideo',
          type: 'video',
          label: 'Hero video',
          propKey: 'heroVideo',
          trimBeforePropKey: 'heroVideoStart',
          trimAfterPropKey: 'heroVideoEnd',
        },
      ],
    };

    const report = validateDesignReport(payload);
    expect(report.blocking).toEqual([]);
    expect(report.advisories.join('\n')).toMatch(/trimBefore|trimAfter|heroVideoStart|heroVideoEnd/);
    expect(payload.editables).toEqual([]);
  });
});
