import { describe, expect, it } from 'vitest';
import { validateDesign } from '@/lib/design-harness';

describe('editable media contract', () => {
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
