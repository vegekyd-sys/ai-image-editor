// @vitest-environment node
import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, writeFile, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer, type Server, type RequestListener} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectPreviewMediaSources, localizePreviewMedia, PREVIEW_MEDIA_PREFETCH_SCRIPT} from '@/lib/remotion-preview-media';
const exec = promisify(execFile);
const cleanups: Array<()=>Promise<unknown>>=[];
afterEach(async()=>{await Promise.all(cleanups.splice(0).map(fn=>fn()));});
async function fixture(respond: RequestListener) {
 const root=await mkdtemp(join(tmpdir(),'preview-cache-test-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
 const script=join(root,'fetch.mjs');await writeFile(script,PREVIEW_MEDIA_PREFETCH_SCRIPT);
 const server: Server=createServer(respond);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>server.close(()=>r())));
 const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/video.mp4`;
 const sources=collectPreviewMediaSources({code:`const src='${url}';`});
 return {root,script,sources,run:(limit=100,timeout=2000)=>exec(process.execPath,[script,JSON.stringify(sources),root,String(limit),'200',String(timeout)])};
}
describe('Sandbox preview media reuse',()=>{
 it('preserves authored code and timing while mapping duplicate/extensionless sources to one local copy',()=>{
  const url='https://scenes-ai.com/v1/assets/asset/media?access=private';
  const design={code:`const shots=[{src:'${url}',trimBefore:600,trimAfter:668}];`,props:{video:url,audio:'https://cdn.makaron.app/voice.mp3'},width:1080,height:1920};
  const sources=collectPreviewMediaSources(design);expect(sources).toHaveLength(1);expect(sources[0].path).not.toContain('private');
  const local=localizePreviewMedia(design,sources);expect(local.code).toContain('trimBefore:600,trimAfter:668');expect(local.props?.video).toBe(sources[0].path);expect(local.props?.audio).toBe(design.props.audio);expect(design.code).toContain(url);
 });
 it('streams once and reuses the completed cache file for subsequent frames',async()=>{
  let requests=0;const f=await fixture((req,res)=>{requests++;res.end('real-source-bytes');});
  await f.run();await f.run();expect(requests).toBe(1);expect(await readFile(join(f.root,f.sources[0].path),'utf8')).toBe('real-source-bytes');
 });
 it('bounds a chunked source with no Content-Length and removes partial files',async()=>{
  const f=await fixture((req,res)=>{res.writeHead(200);res.write('x'.repeat(120));res.end();});
  await expect(f.run(50)).rejects.toThrow();expect(await readdir(join(f.root,'makaron-preview-media'))).toEqual([]);
 });
 it('times out a stalled response body and removes partial files',async()=>{
  const f=await fixture((req,res)=>{res.writeHead(200);res.write('first bytes');});
  await expect(f.run(100,80)).rejects.toThrow();expect(await readdir(join(f.root,'makaron-preview-media'))).toEqual([]);
 });
 it('cancels an in-flight cache download on worker SIGTERM and removes partial files',async()=>{
  let entered!: ()=>void;const downloading=new Promise<void>(resolve=>{entered=resolve;});
  const f=await fixture((req,res)=>{res.writeHead(200);res.write('first bytes');entered();});
  const pending=f.run();await downloading;pending.child.kill('SIGTERM');
  await expect(pending).rejects.toThrow();expect(await readdir(join(f.root,'makaron-preview-media'))).toEqual([]);
 });
});
