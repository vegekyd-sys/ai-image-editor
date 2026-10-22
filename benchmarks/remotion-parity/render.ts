import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { build } from 'esbuild';
import { config } from 'dotenv';
import { fixtures } from './fixtures';
import { resolveRemotionFontManifestUrlForDesign } from '../../src/lib/remotion-font-resolver';
import ffmpegPath from 'ffmpeg-static';

config({path:path.resolve('../ai-image-editor/.env.local'),quiet:true});
const out=path.resolve(process.env.PARITY_OUTPUT_DIR || '/tmp/makaron-expanded-parity');fs.mkdirSync(out,{recursive:true});
const port=8521;
async function main(){
 if(!fs.existsSync(path.join(out,'source.mp4')))execFileSync(ffmpegPath!,['-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=8','-c:v','libx264','-pix_fmt','yuv420p','-crf','16','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',path.join(out,'source.mp4')]);
 const originalManifestUrl=await resolveRemotionFontManifestUrlForDesign({code:fixtures.map(f=>f.code).join('\n')});
 const manifest=await (await fetch(originalManifestUrl)).json();
 const remoteFonts=new Map<string,string>();
 for(const face of manifest.faces){const filename=new URL(face.url,originalManifestUrl).pathname.split('/').pop()!;remoteFonts.set(filename,new URL(face.url,originalManifestUrl).href);face.url=`http://localhost:${port}/fonts/${filename}`;}
 fs.writeFileSync(path.join(out,'fonts.json'),JSON.stringify(manifest));
 const server=http.createServer(async(req,res)=>{
  let pathname=decodeURIComponent(new URL(req.url!,'http://localhost').pathname);
  if(pathname==='/delayed.mp4'){await new Promise(resolve=>setTimeout(resolve,5000));pathname='/source.mp4';}
  if(pathname.startsWith('/fonts/')){const filename=pathname.split('/').pop()!,remote=remoteFonts.get(filename);if(!remote){res.writeHead(404);return res.end();}const file=path.join(out,'fonts',filename);fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file)){const response=await fetch(remote);if(!response.ok){res.writeHead(response.status);return res.end();}fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));}}
  const file=path.resolve(out,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(out+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  const size=fs.statSync(file).size;res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type',file.endsWith('.mp4')?'video/mp4':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':file.endsWith('.woff2')?'font/woff2':'image/png');
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),size-1):size-1;if(start>=size){res.writeHead(416);return res.end();}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}else{res.writeHead(200,{'Content-Length':size});fs.createReadStream(file).pipe(res);}
 });
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
 await build({entryPoints:['benchmarks/remotion-parity/browser.tsx'],bundle:true,outfile:path.join(out,'harness.js'),platform:'browser',define:{'process.env.NODE_ENV':'"development"'},alias:{'@':path.resolve('src')}});
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Remotion parity matrix</title><style>body{margin:16px;background:#111;color:#eee;font:14px system-ui}button{margin:3px;padding:7px}h1{font-size:20px}nav{max-width:1100px}img{display:block}.comparison{display:flex;gap:16px}@media(max-width:900px){.comparison{display:block}.comparison #reference{margin-top:16px}}</style><div id="root">Loading pinned fonts…</div><script src="/harness.js"></script>');
 console.log('BROWSER_HARNESS_READY http://localhost:8521/');
 const serveUrl=await bundle({entryPoint:path.resolve('src/remotion/index.tsx'),outDir:path.join(out,'render-bundle'),onProgress:()=>{}});
 for(const fixture of fixtures){
  const inputProps={code:fixture.code,designProps:fixture.props,fps:30,durationInFrames:240,width:640,height:360,fontManifestUrl:`http://localhost:${port}/fonts.json`};
  const composition=await selectComposition({serveUrl,id:'dynamic-design',inputProps,chromiumOptions:{disableWebSecurity:true,gl:null}});
  for(const mode of ['media','offthread']){
   await renderStill({serveUrl,composition,inputProps:{...inputProps,useOffthreadVideo:mode==='offthread'},output:path.join(out,`${fixture.id}-${mode}.png`),frame:fixture.frame,imageFormat:'png',logLevel:'error',chromiumOptions:{disableWebSecurity:true,gl:null}});
   console.log('RENDERED',fixture.id,mode);
  }
 }
 console.log('MATRIX_RENDER_COMPLETE');
}
main().catch(e=>{console.error(String(e).replace(/https?:\/\/[^\s]+/g,'[URL]'));process.exitCode=1;});
