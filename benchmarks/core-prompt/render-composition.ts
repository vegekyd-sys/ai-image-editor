import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia,renderStill,selectComposition } from '@remotion/renderer';
import { normalizeRemotionScopeDeclarations } from '../../src/lib/remotion-code-normalization';
async function main(){
 const root=path.resolve('artifacts/core-prompt/code');const rows=[];
 for(const variant of ['baseline','candidate']){
  const d=JSON.parse(fs.readFileSync(path.join(root,`composition-${variant}.json`),'utf8'));
  const entryFile=path.join(root,`entry-${variant}.tsx`);
  fs.writeFileSync(entryFile,`import React from 'react';\nimport * as Remotion from 'remotion';\nimport {registerRoot,Composition as RegisteredComposition,AbsoluteFill,useCurrentFrame,useVideoConfig,interpolate,spring,Easing,Sequence,Img,Video,Audio,random} from 'remotion';\n${normalizeRemotionScopeDeclarations(d.code)}\nregisterRoot(()=> <RegisteredComposition id="Scene" component={Composition} width={${d.width}} height={${d.height}} fps={${d.animation.fps}} durationInFrames={${d.animation.fps*d.animation.durationInSeconds}} defaultProps={${JSON.stringify(d.props)}}/>);`);
  const start=Date.now();const serveUrl=await bundle({entryPoint:entryFile,onProgress:()=>{}});
  const composition=await selectComposition({serveUrl,id:'Scene'});
  const out=path.join(root,`composition-${variant}.mp4`);
  await renderMedia({composition,serveUrl,codec:'h264',outputLocation:out,concurrency:2,pixelFormat:'yuv420p'});
  await renderStill({composition,serveUrl,frame:90,output:path.join(root,`composition-${variant}.png`)});
  const patched={...d.props,title:'验收标题修改'};
  await renderStill({composition,serveUrl,frame:90,inputProps:patched,output:path.join(root,`composition-${variant}-patched.png`)});
  rows.push({variant,width:d.width,height:d.height,frames:composition.durationInFrames,fps:composition.fps,elapsedMs:Date.now()-start,output:out,propsPatchRendered:true});
  fs.writeFileSync(path.join(root,'composition-results.json'),JSON.stringify({gate:'local Remotion render and props-patch after one controlled syntax repair; not hosted Preview/Export',rows},null,2));
  fs.renameSync(entryFile,entryFile+'.txt');console.log(JSON.stringify(rows.at(-1)));
 }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
