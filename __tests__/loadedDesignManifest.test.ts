import { describe, expect, it } from 'vitest';
import { normalizeLoadedDesignManifest } from '@/lib/editor/loaded-design-manifest';

describe('loaded composition Editable Manifest', () => {
  it('upgrades persisted helper chains without mutating the stored payload', () => {
    const design = {
      width: 1920,
      height: 1080,
      props: {
        title: 'Chang’an',
        opening: 'An eternal capital',
      },
      editables: [],
      code: `
        function BrushTitle({ text, sub }) {
          return <div><h1>{text}</h1><p>{sub}</p></div>;
        }
        function IntroScene({ title, opening }) {
          return <BrushTitle text={title} sub={opening} />;
        }
        function Composition(props) {
          return <IntroScene title={props.title} opening={props.opening} />;
        }
      `,
    };

    const upgraded = normalizeLoadedDesignManifest(design);

    expect(design.editables).toEqual([]);
    expect(upgraded?.editables).toEqual([
      { id: 'title', type: 'text', label: 'Title', propKey: 'title' },
      { id: 'opening', type: 'text', label: 'Opening', propKey: 'opening' },
    ]);
    expect(upgraded?.code).toContain(
      '__makaronEditable_text={__makaronEditable_title}',
    );
    expect(upgraded?.code).toContain('__makaronEditable_title="title"');
    expect(normalizeLoadedDesignManifest(upgraded)).toEqual(upgraded);
  });
});
