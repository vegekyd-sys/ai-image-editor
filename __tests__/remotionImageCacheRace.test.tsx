import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fontWait = vi.hoisted(() => ({ load: vi.fn(), renders: [] as Array<{ code: string; props: Record<string, unknown> }> }));
beforeEach(() => { fontWait.load.mockReset().mockResolvedValue({ prepared: { code: '', defaultFontFamily: 'Inter' }, timing: {} }); });
vi.mock('@remotion/player', () => ({ Player: ({ component: Component, inputProps }: any) => <div className="__remotion-player"><Component {...inputProps} /></div> }));
vi.mock('@remotion/web-renderer', () => ({ renderStillOnWeb: vi.fn(), renderMediaOnWeb: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/evalRemotionJSX', () => ({ preloadBabel: async () => {}, evalRemotionJSX: (code: string) => (props: any) => { fontWait.renders.push({ code, props }); return <div data-editable="body" data-testid="inputs">{JSON.stringify(props)}</div>; } }));
vi.mock('@/remotion/font-catalog', async original => ({ ...await original<any>(), prepareRemotionFontCodeFromBundledCatalog: () => ({ code: '', defaultFontFamily: 'Inter' }), prepareAndLoadRemotionFontsWithTiming: fontWait.load, validateRemotionFontManifest: (value: unknown) => value }));
vi.mock('@/lib/image/presentation', () => ({ preloadDecodedImage: async () => ({width:100,height:100}) }));
import { applyLayerizeFonts } from '@/lib/layerize-fonts';
import RemotionRenderer, { layerPreviewSources } from '@/components/RemotionRenderer';
import { buildLayerizeDesign, type LayerizeManifest } from '@/lib/layerize-design';
import { fetchPreviewImageBlob, preloadLayerImages } from '@/lib/editor/layer-preview';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('joins the opening layer download and retries a failed preload', async () => {
  const source = 'https://example.com/opening-layer.png';
  const design = { width: 1, height: 1, code: '', props: { layer_0: source },
    editables: [{ id: 'layer_0', propKey: 'layer_0', type: 'image' as const, label: 'Background' }] };
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response('pixels', { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  preloadLayerImages(design);
  await expect(fetchPreviewImageBlob(source)).rejects.toThrow('503');
  expect(fetcher).toHaveBeenCalledTimes(1);
  preloadLayerImages(design);
  const [first, second] = await Promise.all([fetchPreviewImageBlob(source), fetchPreviewImageBlob(source)]);
  expect(second).toBe(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('makes image-only layers editable without downloading fonts for Chinese history labels, retaining native text fonts', async () => {
  const fetcher = vi.fn(async () => Response.json({ faces: [] }));
  vi.stubGlobal('fetch', fetcher);
  const manifest: LayerizeManifest = { version: 1, taskId: 'fonts', width: 100, height: 100, sourceSha256: 'source', supplierCostUsd: .03, layers: [{ z: 0, url: 'data:image/png;base64,aA==', width: 100, height: 100, bounds: [0, 0, 100, 100], name: '背景', text: { lines: [{ text: '真正的文字', bounds: [0, 0, 90, 30], font: 'Noto Sans SC', color: '#000', bold: false, italic: false }] } }] };
  const raster = buildLayerizeDesign(manifest);
  const onLoading = vi.fn();
  const view = render(<RemotionRenderer design={{ ...raster, props: { ...raster.props, _editHistory: { label: '红色礼帽' } } }} snapshotId="raster" onLoading={onLoading} />);
  await waitFor(() => expect(onLoading.mock.calls.at(-1)).toEqual([false]));
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(<RemotionRenderer design={buildLayerizeDesign(manifest, true)} snapshotId="text" onLoading={onLoading} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/remotion/fonts', expect.objectContaining({ method: 'POST' })));
  view.unmount();
});
it('keeps the loading poster until both compilation and the new snapshot images are ready', async () => {
  const pending: Array<(value: Response) => void> = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ready');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/remotion/fonts' ? Promise.resolve(Response.json({ faces: [] })) : new Promise<Response>(resolve => pending.push(resolve))));
  const onLoading = vi.fn();
  const design = { width: 100, height: 100, code: 'function Composition() { return null }', props: { image: 'https://example.com/first.png' } };
  const view = render(<RemotionRenderer design={design} snapshotId="first" onLoading={onLoading} />);
  await waitFor(() => expect(view.getByTestId('inputs')).toBeTruthy());
  expect(onLoading.mock.calls.at(-1)).toEqual([true]);
  await act(async () => { pending[0](new Response('first', { headers: { 'content-type': 'image/png' } })); });
  await waitFor(() => expect(onLoading.mock.calls.at(-1)).toEqual([false]));
  view.rerender(<RemotionRenderer design={{ ...design, props: { image: 'https://example.com/second.png' } }} snapshotId="second" onLoading={onLoading} />);
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(onLoading.mock.calls.at(-1)).toEqual([true]);
  await act(async () => { pending[1](new Response('second', { headers: { 'content-type': 'image/png' } })); });
  await waitFor(() => expect(onLoading.mock.calls.at(-1)).toEqual([false]));
  onLoading.mockClear();
  view.rerender(<RemotionRenderer design={{ ...design, props: { image: 'https://example.com/second.png', _pos_image: { x: 10, y: 0 } } }} snapshotId="second" onLoading={onLoading} />);
  await waitFor(() => expect(view.getByTestId('inputs').textContent).toContain('_pos_image'));
  expect(onLoading).not.toHaveBeenCalledWith(true);
  view.unmount();
});
it('keeps image URLs borrowed by a later props update alive until Player unmount', async () => {
  const pending: Array<(value: Response) => void> = [];
  const create = vi.fn().mockImplementation(() => `blob:preview-${create.mock.calls.length}`);
  const revoke = vi.fn();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(create); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/remotion/fonts' ? Promise.resolve(Response.json({ faces: [] })) : new Promise<Response>(resolve => pending.push(resolve))));
  const design = { width: 100, height: 100, code: 'function Composition() { return null }', props: { base: 'https://example.com/base.png', object: 'https://example.com/object.png' } };
  const view = render(<RemotionRenderer design={design} />);
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => { pending[0](new Response('base', { headers: { 'content-type': 'image/png' } })); });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  view.rerender(<RemotionRenderer design={{ ...design, props: { ...design.props, _pos_object: { x: 20, y: 10 } } }} />);
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => { pending[2](new Response('object new', { headers: { 'content-type': 'image/png' } })); });
  await waitFor(() => expect(view.getByTestId('inputs').textContent).toContain('blob:preview-1'));
  await act(async () => { pending[1](new Response('object late', { headers: { 'content-type': 'image/png' } })); });
  expect(revoke).not.toHaveBeenCalled();
  view.unmount();
  expect(new Set(revoke.mock.calls.map(args => args[0]))).toEqual(new Set(['blob:preview-1', 'blob:preview-2', 'blob:preview-3']));
});
it('releases image URLs that finish loading after Player unmount', async () => {
  const pending: Array<(value: Response) => void> = [];
  const create = vi.fn(() => 'blob:late-image'), revoke = vi.fn();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(create); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/remotion/fonts' ? Promise.resolve(Response.json({ faces: [] })) : new Promise<Response>(resolve => pending.push(resolve))));
  const view = render(<RemotionRenderer design={{ width: 100, height: 100, code: 'function Composition() { return null }', props: { image: 'https://example.com/late.png' } }} />);
  await waitFor(() => expect(pending).toHaveLength(1)); view.unmount();
  await act(async () => { pending[0](new Response('late', { headers: { 'content-type': 'image/png' } })); });
  expect(revoke).toHaveBeenCalledWith('blob:late-image');
});

it('keeps decomposed source canvas fixed while flow-layout designs can still grow', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ faces: [] })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 200, width: 100, height: 200, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
  const flowSize = vi.fn(), layerSize = vi.fn();
  const design = { width: 100, height: 100, code: 'function Composition() { return null }', props: { _layerState: { order: ['title'], deleted: [] } } };
  const flow = render(<RemotionRenderer design={design} onContentSize={flowSize} />);
  await waitFor(() => expect(flowSize).toHaveBeenCalledWith(expect.objectContaining({ height: 200 })));
  flow.unmount();
  const layered = render(<RemotionRenderer design={{ ...design, props: { _canvasSizing: 'fixed', _layerState: { order: [], deleted: [] } } }} onContentSize={layerSize} />);
  await waitFor(() => expect(layered.getByTestId('inputs')).toBeTruthy());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(layerSize).not.toHaveBeenCalled();
  layered.unmount();
});

it('measures overflowing long content in the letterboxed Player canvas coordinates', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ faces: [] })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('__remotion-player') || this.hasAttribute('data-editable') ? 100 : 200;
    const height = this.hasAttribute('data-editable') ? 320 : 100;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
  const size = vi.fn();
  const view = render(<RemotionRenderer design={{ width: 100, height: 100, code: 'function Composition() { return null }', props: {} }} onContentSize={size} />);
  await waitFor(() => expect(size).toHaveBeenCalledWith(expect.objectContaining({ height: 320 })));
  view.unmount();
});

it('ignores the outer viewport height while Player scale catches up after a resize', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ faces: [] })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('__remotion-player') || this.hasAttribute('data-editable') ? 100 : 200;
    const height = this.hasAttribute('data-editable') ? 320 : 100;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('__remotion-player') ? 340 : 3000;
  });
  const size = vi.fn();
  const view = render(<RemotionRenderer design={{ width: 100, height: 100, code: 'function Composition() { return null }', props: {} }} onContentSize={size} />);
  await waitFor(() => expect(size).toHaveBeenCalledWith(expect.objectContaining({ height: 340 })));
  expect(size.mock.calls.every(([value]) => value.height === 340)).toBe(true);
  view.unmount();
});

it('keeps current pixels and edited wording through a slow background-font load, then updates only font metadata', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ faces: [] })));
  const manifest: LayerizeManifest = { version:1, taskId:'async-fonts', width:100, height:100, sourceSha256:'source', supplierCostUsd:.03, layers:[{z:0,name:'Title',url:'data:image/png;base64,aA==',width:100,height:100,bounds:[0,0,100,100],text:{lines:[{text:'HELLO',font:'Arial',color:'#ffffff',bold:false,italic:false,bounds:[0,0,100,100],appearance:{rasterUrl:'data:image/png;base64,aA==',width:100,height:100,bounds:[0,0,100,100]}}]}}] };
  const projectId='11111111-1111-4111-8111-111111111111',snapshotId='22222222-2222-4222-8222-222222222222';
  const base=buildLayerizeDesign(manifest,true,{version:1,projectId,snapshotId,storageOrigin:'https://cdn.makaron.app',storagePath:`/storage/v1/object/public/images/33333333-3333-4333-8333-333333333333/workspace/${projectId}/layerize/${snapshotId}/text-fonts.json`});
  const changed={...base,props:{...base.props,layer_0_text_0:'USER TEXT',_pos_layer_0_text_0:{x:30,y:40}}};
  const onLoading=vi.fn(),view=render(<RemotionRenderer design={changed} onLoading={onLoading}/>);
  await waitFor(()=>expect(onLoading.mock.calls.at(-1)).toEqual([false]));expect(fontWait.load).not.toHaveBeenCalled();
  let release!:(value:unknown)=>void; fontWait.load.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));
  const matched=applyLayerizeFonts(changed,{version:1,status:'ready',fits:{layer_0_text_0:{family:'Lato',weight:900,fontSize:2000,color:'#ffffff',score:.9,matrix:[.1,0,0,.1,0,100]}}});
  view.rerender(<RemotionRenderer design={matched} onLoading={onLoading}/>);
  await waitFor(()=>expect(fontWait.load).toHaveBeenCalledOnce());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,550))});
  expect(view.getByTestId('inputs').textContent).toContain('"status":"pending"');expect(view.getByTestId('inputs').textContent).toContain('USER TEXT');
  await act(async()=>{release({prepared:{code:'',defaultFontFamily:'Inter'},timing:{}})});
  await waitFor(()=>expect(view.getByTestId('inputs').textContent).toContain('"status":"ready"'));
  expect(view.getByTestId('inputs').textContent).toContain('"x":30,"y":40');
  view.rerender(<RemotionRenderer design={{...matched,props:{...matched.props,layer_0_text_0:'NEXT LETTERS'}}} onLoading={onLoading}/>);
  await waitFor(()=>expect(view.getByTestId('inputs').textContent).toContain('NEXT LETTERS'));expect(fontWait.load).toHaveBeenCalledOnce();view.unmount();
});

it('never renders a newly compiled snapshot with the previous snapshot asset keys', async () => {
  fontWait.load.mockImplementation(async ({ code }) => ({ prepared: { code, defaultFontFamily: 'Inter' }, timing: {} }));
  let release!: (response: Response) => void;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:second');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((url: string) => url === 'https://example.com/second.png'
    ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(Response.json({ faces: [] }))));
  const first = { width: 100, height: 100, code: 'function First() { return null }', props: { firstAsset: 'data:image/png;base64,aA==' } };
  const view = render(<RemotionRenderer design={first} snapshotId="first" />);
  await waitFor(() => expect(view.getByTestId('inputs').textContent).toContain('firstAsset'));
  fontWait.renders.length = 0;
  view.rerender(<RemotionRenderer design={{ ...first, code: 'function Second() { return null }', props: { secondAsset: 'https://example.com/second.png' } }} snapshotId="second" posterImage="poster.jpg" />);
  await waitFor(() => expect(fontWait.load).toHaveBeenCalledTimes(2));
  expect(view.queryByTestId('inputs')).toBeNull();
  await act(async () => { release(new Response('second', { headers: { 'content-type': 'image/png' } })); });
  await waitFor(() => expect(view.getByTestId('inputs').textContent).toContain('secondAsset'));
  expect(fontWait.renders.length).toBeGreaterThan(0);
  expect(fontWait.renders.every(rendered => rendered.code.includes('Second') && rendered.props.secondAsset && !rendered.props.firstAsset)).toBe(true);
  view.unmount();
});

it('sizes mobile layer previews by their visible bounds and preserves the source for export', () => {
  const source = 'https://cdn.makaron.app/storage/v1/object/public/images/project/layerize/job/layer-1.png';
  const design = {
    width: 2000, height: 2500,
    props: { _canvasSizing: 'fixed', layer_1: source },
    code: '<Img data-editable="layer_1" src={props.layer_1} style={{"width":200,"height":120}} />',
  };
  const preview = new URL(layerPreviewSources(design, 400, 2).get(source)!);
  expect(preview.pathname).toContain('/render/image/public/');
  expect(preview.searchParams.get('width')).toBe('128');
  expect(preview.searchParams.get('resize')).toBe('contain');
  expect(design.props.layer_1).toBe(source);
});
