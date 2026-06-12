import { describe, expect, it } from 'vitest';
import { validateDesign } from '@/lib/design-harness';

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

  it('rejects editables that are declared but missing data-editable in JSX', () => {
    const result = validateDesign({
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
    });

    expect(result).toEqual(expect.stringMatching(/data-editable/i));
    expect(result).toEqual(expect.stringMatching(/title/));
  });

  it('rejects text editables that do not read from their prop key', () => {
    const result = validateDesign({
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
    });

    expect(result).toEqual(expect.stringMatching(/props\.title|prop key|hardcoded/i));
  });

  it('rejects hardcoded rendered text arrays when a design has editables', () => {
    const result = validateDesign({
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
    });

    expect(result).toEqual(expect.stringMatching(/hardcoded|text editables|names/i));
  });

  it('rejects image editables whose wrapper cannot be measured by Moveable', () => {
    const result = validateDesign({
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
    });

    expect(result).toEqual(expect.stringMatching(/measurable|width|height|inset|box/i));
  });

  it('rejects video editables that declare trim keys but do not wire them to Video props', () => {
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

    expect(result).toEqual(expect.stringMatching(/trimBefore|trimAfter|heroVideoStart|heroVideoEnd/));
  });
});
