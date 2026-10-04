import { describe, expect, it } from 'vitest';
import { analyzeEditableProvenance } from '@/lib/editor/editable-provenance';

describe('Editable provenance analysis', () => {
  it('traces computed-key caption values through maps and helper props', () => {
    const props = {
      openingEn: 'Opening EN',
      openingZh: 'Opening ZH',
      drillingEn: 'Drilling EN',
      drillingZh: 'Drilling ZH',
    };
    const result = analyzeEditableProvenance({
      code: `
        const captionCues = [
          { id: 'opening', enKey: 'openingEn', zhKey: 'openingZh' },
          { id: 'drilling', enKey: 'drillingEn', zhKey: 'drillingZh' },
        ];
        function Caption({ en, zh }) {
          return <div><div>{en}</div><div>{zh}</div></div>;
        }
        function Composition(props) {
          const cue = captionCues.find((item) => item.id === 'opening');
          const textMap = {
            openingEn: props.openingEn,
            openingZh: props.openingZh,
            drillingEn: props.drillingEn,
            drillingZh: props.drillingZh,
          };
          return <Caption en={textMap[cue.enKey]} zh={textMap[cue.zhKey]} />;
        }
      `,
      props,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.fields.map((field) => field.propKey).sort()).toEqual(
      Object.keys(props).sort(),
    );
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.bindingKeys.sort())).toEqual([
      ['drillingEn', 'openingEn'],
      ['drillingZh', 'openingZh'],
    ]);
  });

  it('preserves provenance through object assembly, helpers, String, and replace', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Scene({ scene }) {
          const headline = String(scene.hook || '').replace(/\\\\n/g, '\\n');
          return <><h1>{headline}</h1><small>{scene.name.toUpperCase()}</small></>;
        }
        function Composition(props) {
          const scenes = [
            { hook: props.hookOne, name: props.nameOne },
            { hook: props.hookTwo, name: props.nameTwo },
          ];
          return scenes.map((scene) => <Scene key={scene.name} scene={scene} />);
        }
      `,
      props: {
        hookOne: 'One',
        nameOne: 'First',
        hookTwo: 'Two',
        nameTwo: 'Second',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.fields.map((field) => field.propKey).sort()).toEqual([
      'hookOne',
      'hookTwo',
      'nameOne',
      'nameTwo',
    ]);
  });

  it('separates a source binding from multiple rendered nodes', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Composition(props) {
          return <><h1>{props.title}</h1><footer>{props.title}</footer></>;
        }
      `,
      props: { title: 'Repeated' },
    });

    expect(result.fields.map((field) => field.propKey)).toEqual(['title']);
    expect(result.nodes).toHaveLength(2);
    expect(new Set(result.nodes.map((node) => node.nodeId)).size).toBe(2);
    expect(result.nodes.every((node) => node.bindingKeys[0] === 'title')).toBe(true);
  });

  it('ignores audio and explicitly ignored visual subtrees', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Composition(props) {
          return (
            <>
              <Audio src={props.soundtrack} />
              <div data-editable-ignore>{props.debugLabel}</div>
              <Video src={props.clip} />
              <p>{props.caption}</p>
            </>
          );
        }
      `,
      props: {
        soundtrack: 'sound.wav',
        debugLabel: 'debug',
        clip: 'clip.mp4',
        caption: 'Visible caption',
      },
    });

    expect(result.fields.map((field) => [field.propKey, field.type])).toEqual([
      ['clip', 'video'],
      ['caption', 'text'],
    ]);
  });

  it('keeps existing manifest fields while adding newly traced bindings', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Composition(props) {
          const alias = { missing: props.missing };
          return <><h1 data-editable="known">{props.known}</h1><p>{alias.missing}</p></>;
        }
      `,
      props: { known: 'Known', missing: 'Recovered' },
      editables: [
        { id: 'known', type: 'text', label: 'Known', propKey: 'known' },
      ],
    });

    expect(result.fields.map((field) => field.propKey).sort()).toEqual([
      'known',
      'missing',
    ]);
  });

  it('follows exported entries and classic function map callbacks', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Word({ value }) { return <span>{value}</span>; }
        export function Composition(props) {
          return <div>{props.words.map(function (word) {
            return <Word value={word} />;
          })}</div>;
        }
      `,
      props: { words: ['one', 'two', 'three'] },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.fields.map((field) => field.propKey)).toEqual([
      'word1',
      'word2',
      'word3',
    ]);
  });

  it('does not treat string replacement arguments as rendered text origins', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Label({ value }) {
          const normalized = String(value || '').replace(/\\\\n/g, '\\n');
          return <div>{normalized}</div>;
        }
        function Composition() { return <Label value="" />; }
      `,
      props: {},
    });

    expect(result.fields).toEqual([]);
    expect(result.nodes).toEqual([]);
  });

  it('does not lift a separator inside derived counter text', () => {
    const result = analyzeEditableProvenance({
      code: `
        function Counter({ index, total }) {
          return <span>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>;
        }
        function Composition() { return <Counter index={0} total={7} />; }
      `,
      props: {},
    });

    expect(result.fields).toEqual([]);
  });
});
