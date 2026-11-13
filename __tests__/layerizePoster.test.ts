// @vitest-environment node
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { renderLayerizeRasterPoster } from '@/lib/layerize-poster';
import { buildLayerizeDesign, type LayerizeManifest } from '@/lib/layerize-design';
it('composes the same cropped geometry, alpha and corrected stacking used by the Editable design', async () => {
  const background=await sharp({create:{width:256,height:256,channels:4,background:'#ffffff'}}).png().toBuffer();
  const red=await sharp({create:{width:10,height:10,channels:4,background:'#ff000080'}}).png().toBuffer();
  const blue=await sharp({create:{width:10,height:10,channels:4,background:'#0000ff'}}).png().toBuffer();
  const manifest: LayerizeManifest={version:1,taskId:'task',width:256,height:256,sourceSha256:'source',supplierCostUsd:.05,stackOrder:[0,2,1],layers:[
    {z:0,url:'background',width:256,height:256,bounds:[0,0,256,256],name:'background'},
    {z:1,url:'red',width:10,height:10,bounds:[40,60,120,140],name:'red'},
    {z:2,url:'blue',width:10,height:10,bounds:[32,32,192,192],name:'blue'},
  ]};
  const poster=await renderLayerizeRasterPoster(manifest,new Map([[0,background],[1,red],[2,blue]]));
  const {data,info}=await sharp(poster).raw().toBuffer({resolveWithObject:true});
  const pixel=(x:number,y:number)=>[...data.subarray((y*256+x)*3,(y*256+x)*3+3)];
  expect(info).toMatchObject({width:256,height:256});
  expect(pixel(10,10).every(v=>v>248)).toBe(true);
  const overlap=pixel(80,100);expect(overlap[0]).toBeGreaterThan(120);expect(overlap[2]).toBeGreaterThan(120);expect(overlap[1]).toBeLessThan(5);
  expect(pixel(160,160)[2]).toBeGreaterThan(248);
  expect(buildLayerizeDesign(manifest).props?._layerState).toMatchObject({order:['layer_0','layer_2','layer_1']});
});
