import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { transform } from 'sucrase';
import { buildLayerizeDesign, type LayerizeManifest } from '@/lib/layerize-design';
import { applyLayerizeFonts, layerizeFontRenderKey, layerizeUsesOriginalGlyphs, resolveLayerizeFontsForRender, type LayerizeFontsResult } from '@/lib/layerize-fonts';
import { createEditableReactRuntime } from '@/lib/editor/editable-react-runtime';
import { validateDesign } from '@/lib/design-harness';
import { prepareRemotionFontCodeFromBundledCatalog } from '@/remotion/font-catalog';
import { useLayerizeFonts } from '@/hooks/useLayerizeFonts';
import type { Snapshot } from '@/types';
const projectId='11111111-1111-4111-8111-111111111111',snapshotId='22222222-2222-4222-8222-222222222222';
const reference={version:1 as const,projectId,snapshotId,storageOrigin:'https://cdn.makaron.app',storagePath:`/storage/v1/object/public/images/33333333-3333-4333-8333-333333333333/workspace/${projectId}/layerize/${snapshotId}/text-fonts.json`};
const manifest:LayerizeManifest={version:1,taskId:'retained',width:800,height:500,sourceSha256:'original',supplierCostUsd:.1,layers:[
 {z:0,name:'Background',url:'https://example.com/bg.png',width:800,height:500,bounds:[0,0,800,500]},
 {z:1,name:'Title',url:'https://example.com/title.png',width:400,height:100,bounds:[10,20,410,120],text:{lines:[{text:'HELLO',font:'Arial',color:'#ffffff',bold:false,italic:false,bounds:[10,20,410,120],appearance:{rasterUrl:'https://example.com/glyphs.png',width:400,height:100,bounds:[10,20,410,120]}}]}}]};
const ready:LayerizeFontsResult={version:1,status:'ready',fits:{layer_1_text_0:{family:'Lato',weight:900,fontSize:2000,color:'#ffffff',score:.85,matrix:[.1,0,0,.1,3,95]}}};
function fixture(){const d=buildLayerizeDesign(manifest,true,reference);expect(validateDesign(d)).toBeNull();return d;}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('shows extracted glyphs before matching and renders edited text only after matching, preserving transforms and history',()=>{
 const initial=fixture(),changed={...initial,props:{...initial.props,layer_1_text_0:'WORLD',_pos_layer_0:{x:12,y:24},_scale_layer_1_text_0:{w:.8,h:.8},_editHistory:{past:['user-edit']}}};
 const runtime=createEditableReactRuntime(React,'video'),exports:any={};new Function('require','exports',transform(initial.code,{transforms:['jsx','imports']}).code)((name:string)=>name==='react'?runtime.React:{AbsoluteFill:'div',Img:'img'},exports);
 const paint=(d:typeof initial)=>renderToStaticMarkup(React.createElement(runtime.wrap(exports.default,'proxy'),d.props));
 expect(layerizeUsesOriginalGlyphs(changed)).toBe(true);expect(layerizeFontRenderKey(changed)).toBe('');expect(paint(changed)).toContain('glyphs.png');expect(paint(changed)).not.toContain('<text');
 const completed=applyLayerizeFonts(changed,ready);expect(completed.code).toBe(initial.code);expect(completed.props?.layer_1_text_0).toBe('WORLD');expect(completed.props?._editHistory).toEqual(changed.props._editHistory);expect(paint(completed)).toContain('translate:12px 24px');expect(paint(completed)).toContain('font-family:Lato');expect(paint(completed)).toContain('WORLD');expect(paint(completed)).not.toContain('glyphs.png');
 expect(layerizeUsesOriginalGlyphs(applyLayerizeFonts(initial,ready))).toBe(true);
});
it('does not wait for font matching when exporting unmodified glyphs; changed text hydrates font metadata without overwriting user props',async()=>{
 const d=fixture(),fetcher=vi.fn(async()=>Response.json(ready));vi.stubGlobal('fetch',fetcher);expect(await resolveLayerizeFontsForRender(d)).toBe(d);expect(fetcher).not.toHaveBeenCalled();
 const edited={...d,props:{...d.props,layer_1_text_0:'WORLD',_pos_layer_1_text_0:{x:42,y:73}}};const result=await resolveLayerizeFontsForRender(edited);expect(result.props?._pos_layer_1_text_0).toEqual({x:42,y:73});expect(result.props?.layer_1_text_0).toBe('WORLD');expect(result.props?._layerizeTextFontFits).toEqual(ready.fits);
});
it('merges background results into the latest local edit, including an undo to a pending history entry',async()=>{
 let release!:(r:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>release=r));vi.stubGlobal('fetch',fetcher);
 const d=fixture();let update!:React.Dispatch<React.SetStateAction<Snapshot[]>>;let latest:Snapshot[]=[];
 function Surface(){const[snaps,set]=useState<Snapshot[]>([{id:snapshotId,image:'poster.jpg',tips:[],messageId:'',design:d}]);update=set;latest=snaps;useLayerizeFonts(projectId,snaps,set);return <div/>}
 render(<Surface/>);await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
 await act(async()=>{update(s=>s.map(x=>({...x,design:{...x.design!,props:{...x.design!.props,layer_1_text_0:'USER TEXT',_pos_layer_0:{x:50,y:60}}}})))});
 await act(async()=>{release(Response.json(ready))});await waitFor(()=>expect(latest[0].design?.props?._layerizeTextFontFits).toEqual(ready.fits));expect(latest[0].design?.props?.layer_1_text_0).toBe('USER TEXT');expect(latest[0].design?.props?._pos_layer_0).toEqual({x:50,y:60});
 await act(async()=>{update(s=>s.map(x=>({...x,design:{...x.design!,props:{...d.props,layer_1_text_0:'RESTORED TEXT'}}})))});await waitFor(()=>expect(latest[0].design?.props?._layerizeTextFontFits).toEqual(ready.fits));expect(latest[0].design?.props?.layer_1_text_0).toBe('RESTORED TEXT');expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps pinned CJK fallbacks available when dynamic matched fonts do not contain newly entered Chinese text',()=>{
 const d=applyLayerizeFonts(fixture(),ready);d.props!.layer_1_text_0='你好 Makaron';const prepared=prepareRemotionFontCodeFromBundledCatalog({code:d.code,props:d.props});expect(prepared.usedFamilies).toContain('Lato');expect(prepared.usedFamilies).toContain('Noto Sans SC');
});
