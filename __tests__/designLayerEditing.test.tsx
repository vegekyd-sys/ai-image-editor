import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { transform } from 'sucrase';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { buildLayerizeDesign } from '@/lib/layerize-design';
import { changeDesignLayer, readDesignLayerState } from '@/lib/editor/design-layer-state';
import { normalizeLoadedDesignManifest } from '@/lib/editor/loaded-design-manifest';
import { queueEditableSave } from '@/lib/editor/editable-save-queue';
import { layerizeModelOutput } from '@/lib/layerize-delivery';
import DesignEditPanel from '@/components/DesignEditPanel';
import { LocaleProvider } from '@/lib/i18n';
import { recordDesignEdit } from '@/lib/editor/design-edit-history';

const design = buildLayerizeDesign({ version: 1, taskId: 'original', width: 100, height: 100, sourceSha256: 'hash', supplierCostUsd: .1,
  layers: [0, 1, 2].map(z => ({ z, url: `https://example.com/${z}.png`, width: 100, height: 100, bounds: [0, 0, 100, 100], name: `Layer ${z}` })) });
const fields = design.editables!;
afterEach(cleanup);

function renderDesign(props: Record<string, unknown>, mode: 'proxy' | 'registry' = 'proxy') {
  const runtime = createEditableReactRuntime(React, 'video');
  const exports: any = {};
  new Function('require', 'exports', transform(design.code, { transforms: ['jsx', 'imports'] }).code)(
    (name: string) => name === 'react' ? runtime.React : { AbsoluteFill: 'div', Img: 'img' }, exports);
  return renderToStaticMarkup(React.createElement(runtime.wrap(exports.default, mode), props));
}

describe('Layerize layer editing', () => {
  it('offers the same controls and history for ordinary text/image editables', () => {
    const generic = [{ id: 'hero', propKey: 'hero', type: 'image' as const, label: 'Hero' }, { id: 'title', propKey: 'title', type: 'text' as const, label: 'Title' }];
    const props = recordDesignEdit({ title: 'Hello', hero: 'https://example.com/photo.png' }, '_pos_hero', { x: 20, y: 10 }, { kind: 'move', label: 'Hero' });
    const seek = vi.fn(), update = vi.fn();
    const { getByRole, getByText } = render(<LocaleProvider initialLocale="en"><DesignEditPanel editables={generic} props={props} selectedFieldId="hero" onUpdateProp={update} onSelectField={vi.fn()} onStartEdit={vi.fn()} onHistorySeek={seek} /></LocaleProvider>);
    fireEvent.click(getByRole('button', { name: 'Delete element' }));
    expect(update).toHaveBeenCalledWith('_layerState', expect.objectContaining({ deleted: ['hero'] }));
    fireEvent.click(getByRole('button', { name: 'Undo', exact: true }));
    expect(seek).toHaveBeenCalledWith(0);
    fireEvent.click(getByRole('button', { name: 'Edit history', exact: true }));
    expect(getByRole('dialog', { name: 'Edit history' })).toBeTruthy();
    expect(getByText('Move · Hero')).toBeTruthy();
  });

  it('keeps flex layout slots while ordinary editable paint order changes', () => {
    const runtime = createEditableReactRuntime(React, 'video');
    const exports: any = {};
    const code = `import React from 'react'; export default function Composition(props) { return <div style={{display:'flex',flexDirection:'column'}}><div data-editable="title" style={{height:40}}>{props.title}</div><img data-editable="hero" src={props.hero} style={{height:80}} /></div>; }`;
    new Function('require', 'exports', transform(code, { transforms: ['jsx', 'imports'] }).code)((name: string) => runtime.React, exports);
    const Component = runtime.wrap(exports.default, 'proxy');
    const html = renderToStaticMarkup(<Component title="Hello" hero="https://example.com/a.png" _layerState={{ order: ['hero', 'title'], deleted: [], stacking: true }} />);
    const root = document.createElement('div'); root.innerHTML = html;
    const children = root.querySelector('div')!.children;
    expect(children[0].getAttribute('data-editable')).toBe('hero');
    expect((children[0] as HTMLElement).style.order).toBe('1');
    expect((children[1] as HTMLElement).style.order).toBe('0');
  });
  it('normalizes old designs and malformed orders without losing a layer', () => {
    expect(readDesignLayerState(fields, {})).toEqual({ order: ['layer_0', 'layer_1', 'layer_2'], deleted: [] });
    expect(readDesignLayerState(fields, { _layerState: { order: ['unknown', 'layer_2', 'layer_2'], deleted: ['layer_1', 'unknown'] } })).toEqual({ order: ['layer_2', 'layer_0', 'layer_1'], deleted: ['layer_1'] });
  });
  it('moves across active neighbors, with boundaries and restore preserving source props', () => {
    const state = readDesignLayerState(fields, design.props!);
    expect(changeDesignLayer(state, 'layer_2', 'forward')).toBe(state);
    const deleted = changeDesignLayer(state, 'layer_1', 'delete');
    const moved = changeDesignLayer(deleted, 'layer_0', 'forward');
    expect(moved.order).toEqual(['layer_2', 'layer_1', 'layer_0']);
    expect(changeDesignLayer(moved, 'layer_1', 'restore').deleted).toEqual([]);
    expect(design.props!.layer_1).toBe('https://example.com/1.png');
  });
  for (const mode of ['proxy', 'registry'] as const) {
    it(`uses real DOM order and removes deleted media in ${mode} runtime, surviving JSON save/load`, () => {
      const props = { ...design.props, _layerState: { order: ['layer_2', 'layer_0', 'layer_1'], deleted: ['layer_0'] } };
      const loaded = normalizeLoadedDesignManifest(JSON.parse(JSON.stringify({ ...design, props })))!;
      const html = renderDesign(loaded.props!, mode);
      expect(html).not.toContain('0.png');
      expect(html).not.toContain('data-editable="layer_0"');
      expect(html.indexOf('data-editable="layer_2"')).toBeLessThan(html.indexOf('data-editable="layer_1"'));
      const restored = renderDesign({ ...loaded.props, _layerState: { order: ['layer_2', 'layer_0', 'layer_1'], deleted: [] } }, mode);
      expect(restored).toContain('0.png');
      expect(restored.indexOf('data-editable="layer_2"')).toBeLessThan(restored.indexOf('data-editable="layer_0"'));
    });
  }
  it('keeps delete/restore accessible after every layer is removed', () => {
    const update = vi.fn(), select = vi.fn();
    const { getByRole, rerender } = render(<LocaleProvider initialLocale="en"><DesignEditPanel editables={fields} props={design.props} selectedFieldId="layer_1" onUpdateProp={update} onSelectField={select} onStartEdit={vi.fn()} /></LocaleProvider>);
    fireEvent.click(getByRole('button', { name: 'Delete element' }));
    expect(update).toHaveBeenCalledWith('_layerState', { order: ['layer_0', 'layer_1', 'layer_2'], deleted: ['layer_1'] });
    expect(select).toHaveBeenCalledWith(null);
    rerender(<LocaleProvider initialLocale="en"><DesignEditPanel editables={fields} props={{ ...design.props, _layerState: { order: fields.map(f => f.id), deleted: fields.map(f => f.id) } }} selectedFieldId={null} onUpdateProp={update} onSelectField={select} onStartEdit={vi.fn()} /></LocaleProvider>);
    fireEvent.click(getByRole('button', { name: 'Restore deleted element' }));
    expect(update).toHaveBeenLastCalledWith('_layerState', { order: ['layer_0', 'layer_1', 'layer_2'], deleted: ['layer_0', 'layer_1'] });
  });
});

describe('Layerize delivery by surface', () => {
  const receipt = { success: true, status: 'completed', projectUrl: 'https://www.makaron.app/projects/test', jobId: 'job-private', designPath: 'code/private.json' };
  it('delivers in place on web without technical receipts or a repeated project link', () => {
    const text = layerizeModelOutput(receipt, 'app');
    expect(text).toContain('displayed in this Makaron page');
    for (const value of [receipt.projectUrl, receipt.jobId, receipt.designPath]) expect(text).not.toContain(value);
  });
  it('retains the edit link for external chat and original ID for pending recovery', () => {
    expect(layerizeModelOutput(receipt)).toContain(receipt.projectUrl);
    expect(layerizeModelOutput(receipt)).not.toContain(receipt.designPath);
    expect(layerizeModelOutput({ ...receipt, status: 'processing' }, 'app')).toContain(receipt.jobId);
  });
});


describe('ordered composition saves', () => {
  it('retains deletion when the preceding reorder request is delayed, and continues after an error', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let persisted = 'original';
    const first = queueEditableSave('same-design', async () => { await gate; persisted = 'reordered'; });
    const second = queueEditableSave('same-design', async () => { persisted = 'reordered-and-deleted'; });
    await Promise.resolve();
    expect(persisted).toBe('original');
    release(); await Promise.all([first, second]);
    expect(persisted).toBe('reordered-and-deleted');
    await expect(queueEditableSave('same-design', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await queueEditableSave('same-design', async () => { persisted = 'restored'; });
    expect(persisted).toBe('restored');
  });
});
