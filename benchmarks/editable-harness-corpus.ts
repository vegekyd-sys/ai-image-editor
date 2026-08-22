import type { EditableField, EditableType } from '../src/types';

export interface EditableBenchmarkExpectedField {
  id: string;
  type: EditableType;
  /** Required fields participate in release gates. Optional fields are bonus coverage. */
  required?: boolean;
  /** False when the fixture intentionally renders another conditional branch. */
  mutate?: boolean;
  occurrences?: number;
}

export interface EditableBenchmarkCase {
  id: string;
  label: string;
  pattern: string;
  code: string;
  props: Record<string, unknown>;
  editables?: EditableField[];
  expected: EditableBenchmarkExpectedField[];
  expectAdvisory?: boolean;
}

const video = (name: string) => `https://benchmark.invalid/${name}.mp4`;
const image = (name: string) => `https://benchmark.invalid/${name}.jpg`;

export const EDITABLE_HARNESS_BENCHMARK_CORPUS: EditableBenchmarkCase[] = [
  {
    id: 'direct-mixed-props',
    label: 'Direct text, image, and video props',
    pattern: 'direct-props',
    code: `
function Composition(props) {
  return (
    <main>
      <h1>{props.title}</h1>
      <Img src={props.heroImage} />
      <Video src={props.heroVideo} />
    </main>
  );
}
`,
    props: {
      title: 'Factory story',
      heroImage: image('hero'),
      heroVideo: video('hero'),
    },
    expected: [
      { id: 'title', type: 'text' },
      { id: 'heroImage', type: 'image' },
      { id: 'heroVideo', type: 'video' },
    ],
  },
  {
    id: 'reusable-text-components',
    label: 'Reusable chapter components',
    pattern: 'helper-props',
    code: `
function Chapter({ year, title, description }) {
  return <section><div>{year}</div><h2>{title}</h2><p>{description}</p></section>;
}
function Composition(props) {
  return (
    <main>
      <Chapter year={props.yearOne} title={props.titleOne} description={props.descriptionOne} />
      <Chapter year={props.yearTwo} title={props.titleTwo} description={props.descriptionTwo} />
    </main>
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
    expected: [
      { id: 'yearOne', type: 'text' },
      { id: 'titleOne', type: 'text' },
      { id: 'descriptionOne', type: 'text' },
      { id: 'yearTwo', type: 'text' },
      { id: 'titleTwo', type: 'text' },
      { id: 'descriptionTwo', type: 'text' },
    ],
  },
  {
    id: 'unsafe-static-video-helper',
    label: 'Reusable video helper with one unsafe authored marker',
    pattern: 'media-ownership-guard',
    code: `
function Clip({ src }) {
  return <Video data-editable="strings" src={src} />;
}
function Composition(props) {
  const clips = { strings: props.strings, paint: props.paint, inspect: props.inspect };
  const segments = [clips.strings, clips.paint, clips.inspect];
  return <main>{segments.map((src, index) => <Clip key={index} src={src} />)}</main>;
}
`,
    props: {
      strings: video('strings'),
      paint: video('paint'),
      inspect: video('inspect'),
    },
    editables: [
      { id: 'strings', type: 'video', label: 'Strings', propKey: 'strings' },
    ],
    expected: [
      { id: 'strings', type: 'video' },
      { id: 'paint', type: 'video' },
      { id: 'inspect', type: 'video' },
    ],
  },
  {
    id: 'media-array-prop',
    label: 'Video array routed through a reusable helper',
    pattern: 'array-map',
    code: `
function Clip({ src }) { return <Video src={src} />; }
function Composition(props) {
  return <main>{props.clips.map((src) => <Clip key={src} src={src} />)}</main>;
}
`,
    props: {
      clips: [video('clip-one'), video('clip-two'), video('clip-three')],
    },
    expected: [
      { id: 'clip1', type: 'video' },
      { id: 'clip2', type: 'video' },
      { id: 'clip3', type: 'video' },
    ],
  },
  {
    id: 'jsx-alias-conditional-video',
    label: 'Video JSX alias returned directly or through a Loop wrapper',
    pattern: 'jsx-alias-conditional-wrapper',
    code: `
function VideoFill({ src, loop = false }) {
  const videoNode = <Video src={src} />;
  return loop ? <Loop durationInFrames={90}>{videoNode}</Loop> : videoNode;
}
function Composition(props) {
  return (
    <main>
      <VideoFill src={props.clipOne} />
      <VideoFill src={props.clipTwo} loop />
      <VideoFill src={props.clipThree} />
    </main>
  );
}
`,
    props: {
      clipOne: video('alias-one'),
      clipTwo: video('alias-two'),
      clipThree: video('alias-three'),
    },
    expected: [
      { id: 'clipOne', type: 'video' },
      { id: 'clipTwo', type: 'video' },
      { id: 'clipThree', type: 'video' },
    ],
  },
  {
    id: 'image-card-helper',
    label: 'Image cards with captions',
    pattern: 'nested-media-text',
    code: `
function Card({ image, caption }) {
  return <article><Img src={image} /><p>{caption}</p></article>;
}
function Composition(props) {
  return (
    <main>
      <Card image={props.imageOne} caption={props.captionOne} />
      <Card image={props.imageTwo} caption={props.captionTwo} />
    </main>
  );
}
`,
    props: {
      imageOne: image('one'),
      captionOne: 'First image',
      imageTwo: image('two'),
      captionTwo: 'Second image',
    },
    expected: [
      { id: 'imageOne', type: 'image' },
      { id: 'captionOne', type: 'text' },
      { id: 'imageTwo', type: 'image' },
      { id: 'captionTwo', type: 'text' },
    ],
  },
  {
    id: 'computed-key-captions',
    label: 'Computed-key bilingual caption map',
    pattern: 'computed-key-map',
    code: `
const cues = [{ enKey: 'openingEn' }, { enKey: 'drillingEn' }];
function Caption({ en }) { return <div>{en}</div>; }
function Composition(props) {
  const textMap = { openingEn: props.openingEn, drillingEn: props.drillingEn };
  return <main>{cues.map((cue) => <Caption key={cue.enKey} en={textMap[cue.enKey]} />)}</main>;
}
`,
    props: {
      openingEn: 'The line starts here.',
      drillingEn: 'Precision drilling follows.',
    },
    expected: [
      { id: 'openingEn', type: 'text' },
      { id: 'drillingEn', type: 'text' },
    ],
  },
  {
    id: 'scene-object-array',
    label: 'Scene records mapped into text leaves',
    pattern: 'nested-array-records',
    code: `
function SceneCard({ title, description }) {
  return <section><h2>{title}</h2><p>{description}</p></section>;
}
function Composition(props) {
  return <main>{props.scenes.map((scene) => (
    <SceneCard key={scene.title} title={scene.title} description={scene.description} />
  ))}</main>;
}
`,
    props: {
      scenes: [
        { title: 'Opening', description: 'Raw material enters.' },
        { title: 'Finish', description: 'The final product leaves.' },
      ],
    },
    expected: [
      { id: 'scene1Title', type: 'text' },
      { id: 'scene1Description', type: 'text' },
      { id: 'scene2Title', type: 'text' },
      { id: 'scene2Description', type: 'text' },
    ],
  },
  {
    id: 'hardcoded-visible-copy',
    label: 'Visible hardcoded copy promoted to props',
    pattern: 'literal-promotion',
    code: `
function Composition() {
  return <main><h1>Launch day</h1><p>Everything changes today.</p></main>;
}
`,
    props: {},
    expected: [
      { id: 'compositionTitle', type: 'text' },
      { id: 'compositionParagraph', type: 'text' },
    ],
  },
  {
    id: 'conditional-copy',
    label: 'Conditional copy with two stable prop owners',
    pattern: 'conditional-expression',
    code: `
function Composition(props) {
  return <main><h1>{props.compact ? props.shortTitle : props.longTitle}</h1></main>;
}
`,
    props: {
      compact: false,
      shortTitle: 'Short',
      longTitle: 'A longer product launch title',
    },
    expected: [
      { id: 'shortTitle', type: 'text', mutate: false },
      { id: 'longTitle', type: 'text' },
    ],
  },
  {
    id: 'repeated-identical-media',
    label: 'Distinct media props with the same URL',
    pattern: 'identity-collision',
    code: `
function Clip({ src }) { return <Video src={src} />; }
function Composition(props) {
  return <main><Clip src={props.firstClip} /><Clip src={props.secondClip} /></main>;
}
`,
    props: {
      firstClip: video('shared-source'),
      secondClip: video('shared-source'),
    },
    expected: [
      { id: 'firstClip', type: 'video' },
      { id: 'secondClip', type: 'video' },
    ],
  },
  {
    id: 'sentence-split-caption',
    label: 'Sentence caption rendered through word spans',
    pattern: 'split-map-aggregation',
    code: `
function Caption({ sentence }) {
  return <div>{sentence.split(' ').map((word, index) => <span key={index}>{word} </span>)}</div>;
}
function Composition(props) {
  return <main><Caption sentence={props.caption} /></main>;
}
`,
    props: {
      caption: 'One editable sentence across styled words',
    },
    expected: [
      { id: 'caption', type: 'text' },
    ],
  },
  {
    id: 'hardcoded-accent-caption-array',
    label: 'Hardcoded caption records split around a styled accent',
    pattern: 'literal-caption-array-accent-split',
    code: `
function Caption({ text, accent }) {
  const parts = text.split(accent);
  return <div>{parts[0]}<span>{accent}</span>{parts[1]}</div>;
}
function Composition() {
  const captions = [
    { text: 'A racket survives a tiny factory Olympics.', accent: 'factory Olympics' },
    { text: 'Every edge gets the final polish.', accent: 'final polish' },
  ];
  return <main>{captions.map((caption) => (
    <Caption key={caption.text} text={caption.text} accent={caption.accent} />
  ))}</main>;
}
`,
    props: {},
    expected: [
      { id: 'literal4_1holvqn', type: 'text' },
      { id: 'literal4_13255x2', type: 'text' },
    ],
  },
  {
    id: 'stale-authored-metadata',
    label: 'Valid inferred field survives one stale authored field',
    pattern: 'fail-soft-partial',
    code: `
function Composition(props) {
  return <main><Video src={props.heroVideo} /></main>;
}
`,
    props: {
      heroVideo: video('safe-hero'),
      orphanText: 'Not rendered',
    },
    editables: [
      { id: 'orphanText', type: 'text', label: 'Orphan', propKey: 'orphanText' },
    ],
    expected: [
      { id: 'heroVideo', type: 'video' },
    ],
    expectAdvisory: true,
  },
];
