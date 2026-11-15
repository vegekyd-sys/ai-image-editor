import { expect, it } from 'vitest';
import { buildLayerizeDesign, type LayerizeManifest } from '@/lib/layerize-design';
import { packageLayout, packagePeerTransforms } from '@/lib/editor/package-lettering';
import { applyElementEdit } from '@/lib/editor/element-edit';
import { seekDesignEditHistory } from '@/lib/editor/design-edit-history';

const fixture: LayerizeManifest = {
  version: 1, taskId: 'fixture', width: 200, height: 200, sourceSha256: '', supplierCostUsd: 0,
  layers: [
    { z: 0, url: 'base', width: 200, height: 200, name: '背景', bounds: [0,0,200,200] },
    { z: 1, url: 'can', width: 60, height: 120, name: '苏打汽水易拉罐主体', bounds: [40,30,100,150] },
    { z: 2, url: 'ink', width: 40, height: 20, name: '罐身英文 Soda Water', bounds: [50,60,90,80] },
    { z: 3, url: 'title', width: 50, height: 20, name: '海报主标题 Soda Water', bounds: [45,40,95,60] },
  ],
};
const receipt = { version: 1 as const, id: 'edit', sourceSnapshotId: 'snapshot', fieldId: 'layer_2' };
it('moves from either member, preserves existing relative edits and undoes the entire gesture', () => {
  const design = buildLayerizeDesign(fixture);
  design.props!._pos_layer_1 = {x: 12, y: 3};
  expect([...packageLayout(design).owners]).toEqual([['layer_2', 'layer_1']]);
  const moved = applyElementEdit(design, {...receipt, operation: {kind:'transform', dx:5, dy:8}});
  expect(moved.props).toMatchObject({_pos_layer_1:{x:17,y:11}, _pos_layer_2:{x:5,y:8}});
  expect(moved.props?._pos_layer_3).toBeUndefined();
  const undone = seekDesignEditHistory(moved.props!, 0);
  expect(undone._pos_layer_1).toEqual({x:12,y:3});
  expect(undone._pos_layer_2).toBeUndefined();
  const peers = packagePeerTransforms(packageLayout(design), {}, 'layer_1', {x:3,y:2}, {w:2,h:2});
  expect(peers).toEqual({_pos_layer_2:{x:3,y:-18},_scale_layer_2:{w:2,h:2}});
});
it('retains independent text values and uses explicit ownership for native text', () => {
  const layer = {...fixture.layers[2],name:'Brand [on: 苏打汽水易拉罐主体]',text:{lines:[
    {text:'SODA',bounds:fixture.layers[2].bounds,font:'Arial',color:'#000',bold:false,italic:false},
  ]}};
  const design = buildLayerizeDesign({...fixture,layers:[...fixture.layers.slice(0,2),layer]}, true);
  const fieldId = 'layer_2_text_0';
  expect(packageLayout(design).owners.get(fieldId)).toBe('layer_1');
  const changed = applyElementEdit(design, {...receipt,fieldId,operation:{kind:'text',text:'LIME'}});
  expect(changed.props).toMatchObject({layer_1:'can',[fieldId]:'LIME'});
  expect(changed.props?._pos_layer_1).toBeUndefined();
});
it('leaves ambiguous owners, free headlines, and ordinary editable designs independent', () => {
  const extra = {...fixture.layers[1],z:4, name:'第二个易拉罐'};
  const d = buildLayerizeDesign({...fixture,layers:[...fixture.layers,extra]});
  expect(packageLayout(d).owners.size).toBe(0);
  expect(packageLayout({...d,animation:{fps:30,durationInSeconds:2}}).owners.size).toBe(0);
});
