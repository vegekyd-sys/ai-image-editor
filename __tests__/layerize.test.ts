import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'sucrase';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLayerizeDesign, isRasterLayerizeDesign, layerizeSupplierCost, type LayerizeManifest } from '@/lib/layerize-design';
import { layerizeRequest, submitLayerize, queryLayerize } from '@/lib/layerize-provider';
import { validateDesign } from '@/lib/design-harness';
import { providerCostToCredits } from '@/lib/billing/token-rates';
import { normalizeLoadedDesignManifest } from '@/lib/editor/loaded-design-manifest';

const manifest: LayerizeManifest = { version: 1, taskId: 'task-one', width: 1000, height: 700, sourceSha256: 'hash', supplierCostUsd: .0544, layers: [
  { z: 2, url: 'https://example.com/text.png', width: 1024, height: 1024, bounds: [100, 60, 700, 180], name: 'Title', text: { lines: [{ text: 'HELLO', bounds: [100, 60, 700, 180], font: 'Arial', color: '#123456', bold: true, italic: false }] } },
  { z: 0, url: 'https://example.com/base.png', width: 1000, height: 700, bounds: [0, 0, 1000, 700], name: 'Background' },
  { z: 1, url: 'https://example.com/ball.png', width: 1024, height: 1024, bounds: [800, 450, 900, 550], name: 'Ball' },
] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Layerize standard design contract', () => {
  it('recognizes image-only saved layers without skipping fonts for native text or authored content', () => {
    const raster = buildLayerizeDesign(manifest);
    expect(isRasterLayerizeDesign({ ...raster, props: { ...raster.props, _editHistory: { label: '红色礼帽' } } })).toBe(true);
    expect(isRasterLayerizeDesign(buildLayerizeDesign(manifest, true))).toBe(false);
    expect(isRasterLayerizeDesign({ ...raster, code: raster.code.replace('</AbsoluteFill>', '<div>Keep my font</div></AbsoluteFill>') })).toBe(false);
    expect(isRasterLayerizeDesign({ ...raster, code: 'function Design(){return <div>Text with image editables</div>}' })).toBe(false);
    expect(isRasterLayerizeDesign({ ...raster, animation: { fps: 30, durationInSeconds: 2 } })).toBe(false);
  });
  it('uses base-coordinate bounds and independent properties in z order, never raster dimensions for placement', () => {
    const design = buildLayerizeDesign(manifest);
    expect(design.editables?.map(item => item.id)).toEqual(['layer_0', 'layer_1', 'layer_2']);
    expect(new Set(design.editables?.map(item => item.propKey)).size).toBe(3);
    expect(design.code).toContain('"left":800,"top":450,"width":100,"height":100');
    expect(design.code.indexOf('props.layer_0')).toBeLessThan(design.code.indexOf('props.layer_1'));
    expect(validateDesign(design)).toBeNull();
    expect(design.editables).toHaveLength(3);
    expect(design.editables?.every(item => item.type === 'image')).toBe(true);
    const loaded = normalizeLoadedDesignManifest(design)!;
    expect(loaded.editables).toEqual(design.editables);
    expect(loaded.editables?.map(field => field.propKey)).toEqual(['layer_0', 'layer_1', 'layer_2']);
    expect(normalizeLoadedDesignManifest(loaded)).toEqual(loaded);
  });
  it('keeps every media marker through the production React Proxy and isolates one source/transform change', () => {
    const design = normalizeLoadedDesignManifest(buildLayerizeDesign(manifest))!;
    const runtime = createEditableReactRuntime(React, 'video');
    const exports: any = {};
    const compiled = transform(design.code, { transforms: ['jsx', 'imports'] }).code;
    new Function('require', 'exports', compiled)((name: string) => name === 'react' ? runtime.React : { AbsoluteFill: 'div', Img: 'img' }, exports);
    const Component = runtime.wrap(exports.default, 'proxy');
    const baseline = renderToStaticMarkup(React.createElement(Component, design.props));
    expect((baseline.match(/data-editable=/g) || []).length).toBe(3);
    const changed = renderToStaticMarkup(React.createElement(Component, { ...design.props, layer_1: 'https://example.com/replaced.png', _pos_layer_1: { x: 20, y: 10 }, _scale_layer_1: { w: 1.5, h: 1.5 } }));
    expect(changed).toContain('https://example.com/replaced.png');
    expect(changed).toContain('https://example.com/base.png');
    expect(changed).toContain('https://example.com/text.png');
    expect(changed).toContain('translate:20px 10px');
    expect(changed).toContain('scale:1.5');
    expect((changed.match(/data-editable=/g) || []).length).toBe(3);
  });
  it('explicit text mode uses normal editable text while raster mode keeps original PNG', () => {
    const text = buildLayerizeDesign(manifest, true), raster = buildLayerizeDesign(manifest);
    expect(text.props?.layer_2_text_0).toBe('HELLO');
    expect(text.editables?.at(-1)).toMatchObject({ type: 'text', propKey: 'layer_2_text_0' });
    expect(text.code).toContain('fontFamily');
    expect(raster.props?.layer_2).toBe('https://example.com/text.png');
    expect(validateDesign(text)).toBeNull();
    // Ordinary design properties stay isolated when one layer is changed.
    text.props = { ...text.props, layer_2_text_0: 'WORLD', _pos_layer_1: { x: 20, y: 10 } };
    expect(text.props.layer_1).toBe('https://example.com/ball.png');
    expect(text.props.layer_0).toBe('https://example.com/base.png');
  });
  it('bills actual output inventory including base, handles threshold, rounds the whole task once', () => {
    expect(layerizeSupplierCost([{ width: 2610, height: 1000 }, { width: 2611, height: 1000 }])).toBe(.0504);
    expect(providerCostToCredits(layerizeSupplierCost(manifest.layers), 2)).toBe(11);
    expect(providerCostToCredits(layerizeSupplierCost(Array.from({ length: 5 }, () => ({ width: 1024, height: 1024 }))), 2)).toBe(18);
    expect(() => layerizeSupplierCost([{ width: 0, height: 1 }])).toThrow();
  });
});
describe('Layerize paid request boundary', () => {
  it('sends exactly one input, explicit PNG/OCR, default 8 including base; rejects unsupported values before POST', () => {
    expect(layerizeRequest({ imageUrl: 'https://example.com/a.png' })).toMatchObject({ model: 'doubao-seedream-5.5-layerize', n: 8, output_format: 'png', model_params: { text_recognition: true }, image_urls: ['https://example.com/a.png'] });
    for (const n of [0, 1, 101, 2.5]) expect(() => layerizeRequest({ imageUrl: 'https://example.com/a.png', maxOutputs: n })).toThrow();
    for (const imageUrl of ['http://example.com/a', 'https://key:secret@example.com/a']) expect(() => layerizeRequest({ imageUrl })).toThrow();
    expect(() => layerizeRequest({ imageUrl: 'https://example.com/a.png', quality: '4K' as never })).toThrow();
  });
  it('never replays an uncertain paid POST or exposes credential/provider body', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test-private-key');
    const fetcher = vi.fn().mockRejectedValue(new Error('test-private-key'));
    vi.stubGlobal('fetch', fetcher);
    await expect(submitLayerize({ imageUrl: 'https://example.com/a.png' })).rejects.toThrow('outcome is unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('private provider failure', { status: 503 }));
    await expect(submitLayerize({ imageUrl: 'https://example.com/a.png' })).rejects.toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('queries only original task and rejects a mismatched model/receipt', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test-private-key');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'task-one', model: 'another-model', status: 'completed' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(queryLayerize('task-one')).rejects.toThrow('receipt is invalid');
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.evolink.ai/v1/tasks/task-one');
  });
});
