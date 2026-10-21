// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EXPORT_MEDIA_PREPARATION_SCRIPT} from '@/lib/remotion-export-media-script';
import {exportMediaCacheKey, prepareRemotionExportMedia, type ExportMediaManifest, type ExportMediaStore} from '@/lib/remotion-export-media';
import {findFfmpeg, findFfprobe} from '@/lib/ffmpeg-runtime';
const exec = promisify(execFile);
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {vi.unstubAllEnvs(); await Promise.all(cleanups.splice(0).map(fn => fn()));});

async function fixture(options: {hevc?: boolean; rotate4k?: boolean; fps?: number} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'export-media-test-'));
  cleanups.push(() => rm(root, {recursive: true, force: true}));
  const ffmpeg = await findFfmpeg(), ffprobe = await findFfprobe();
  const source = path.join(root, 'fixture.mp4'), encoded = path.join(root, 'encoded.mp4');
  const size = options.rotate4k ? '3840x2160' : '320x180';
  const rate = options.fps || 60;
  const duration = options.rotate4k ? '0.2' : '1';
  await exec(ffmpeg, ['-v','error','-f','lavfi','-i',`color=c=red:s=${size}:r=${rate}:d=${duration}`,
    '-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,
    '-c:v',options.hevc?'libx265':'libx264','-preset','ultrafast',
    ...(options.hevc?['-x265-params','pools=1:frame-threads=1:log-level=error']:[]),
    '-threads','2','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',encoded]);
  await exec(ffmpeg, ['-v','error',...(options.rotate4k?['-display_rotation','90']:[]),'-i',encoded,'-c','copy',source]);
  const bytes = await readFile(source);
  const server = createServer((req, res) => {
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length-1) : bytes.length-1;
    res.writeHead(range?206:200, {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,
      ...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
    res.end(bytes.subarray(start,end+1));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/video.mp4?access=private-source-token`;
  const work = path.join(root, 'worker');
  await import('node:fs/promises').then(fs => fs.mkdir(work));
  const script = path.join(work,'prepare.cjs');
  await writeFile(script,EXPORT_MEDIA_PREPARATION_SCRIPT);
  async function run(extra: Record<string, unknown> = {}) {
    await writeFile(path.join(work,'request.json'),JSON.stringify({action:'prepare',url,fps:30,timeoutMs:20000,...extra}));
    return exec(process.execPath,[script],{cwd:work,env:{...process.env,FFMPEG_PATH:ffmpeg,FFPROBE_PATH:ffprobe},timeout:25000});
  }
  return {work, run, manifest:async()=>JSON.parse(await readFile(path.join(work,'result.json'),'utf8')) as ExportMediaManifest};
}

describe('export media preparation runtime', () => {
  it('normalizes HEVC/high fps while retaining source duration and audio', async () => {
    const f = await fixture({hevc:true}); await f.run(); const m = await f.manifest();
    expect(m.prepared).toBe(true); expect(m.original.codec).toBe('hevc');
    expect(m.output).toMatchObject({codec:'h264',width:320,height:180,fps:30,audioStreams:1});
    expect(Math.abs(m.output!.duration-m.original.duration)).toBeLessThan(0.15);
    expect(await readdir(f.work)).not.toContain('source.bin');
  },30000);
  it('bakes rotation into the prepared file without reducing original 4K resolution', async () => {
    const f = await fixture({rotate4k:true}); await f.run(); const m = await f.manifest();
    expect(m.original).toMatchObject({width:2160,height:3840});
    expect(m.output).toMatchObject({width:2160,height:3840,fps:30,audioStreams:1});
  },30000);
  it('keeps compatible originals and avoids a full download/transcode', async () => {
    const f = await fixture({fps:30}); await f.run();
    expect(await f.manifest()).toMatchObject({prepared:false,reason:'compatible'});
    expect(await readdir(f.work)).not.toContain('prepared.mp4');
  },30000);
  it('does not transcode ordinary H.264 solely because its fps exceeds composition fps', async () => {
    const f = await fixture({fps:60}); await f.run();
    expect(await f.manifest()).toMatchObject({prepared:false,reason:'compatible'});
  },30000);
  it('enforces the download budget, removes partials, and redacts signed URLs', async () => {
    const f = await fixture({hevc:true});
    const error = await f.run({maxBytes:10}).catch(e=>e);
    expect(error.code).not.toBe(0); expect(error.stderr).not.toContain('private-source-token');
    expect(await readdir(f.work)).not.toContain('source.bin');
    expect(await readdir(f.work)).not.toContain('result.json');
    expect(await readdir(f.work)).not.toContain('prepared.mp4');
  },30000);
});

const manifest = {prepared:true,bytes:100,original:{codec:'hevc',width:3840,height:2160,fps:60,duration:25,audioStreams:1,hdr:false,alpha:false}} satisfies ExportMediaManifest;
function backend() {
  const cache = new Map<string,ExportMediaManifest>();
  const store: ExportMediaStore = {
    read:vi.fn(async key=>cache.get(key)||null),
    uploadUrl:vi.fn(async()=> 'https://storage.example/upload?signature=private'),
    commit:vi.fn(async(key,m)=>{cache.set(key,m);}),
    renderUrl:vi.fn(async()=> 'https://storage.example/compatible.mp4?signature=fresh'),
  };
  const runner = {prepare:vi.fn(async()=>manifest),upload:vi.fn(async()=>{}),stop:vi.fn(async()=>{})};
  return {store,runner,createRunner:vi.fn(async()=>runner)};
}
describe('public export pipeline media contract', () => {
  it('reuses compatible media without changing authored source URLs, trims, or editables', async () => {
    const src = 'https://scenes-ai.com/v1/assets/4k/media?access=private';
    const design = {width:1080,height:1920,code:`<Video src="${src}" trimBefore={540} trimAfter={750}/>`,props:{clip:src,audio:'https://cdn.example/audio.wav'},animation:{fps:30,durationInSeconds:20}};
    const original = structuredClone(design), b = backend();
    const first = await prepareRemotionExportMedia(design,{userId:'owner',...b});
    expect(first.design.code).toContain('trimBefore={540} trimAfter={750}');
    expect(first.design.props?.clip).toContain('compatible.mp4');
    expect(first.design.props?.audio).toBe(design.props.audio); expect(design).toEqual(original);
    const second = await prepareRemotionExportMedia(design,{userId:'owner',...b});
    expect(second.summary.cacheHits).toBe(1); expect(b.runner.prepare).toHaveBeenCalledTimes(1);
    expect(b.store.renderUrl).toHaveBeenCalledTimes(2); // Fresh signed URL on every export.
    await prepareRemotionExportMedia(design,{userId:'different-owner',...b});
    expect(b.runner.prepare).toHaveBeenCalledTimes(2);
    expect(exportMediaCacheKey('owner',src,30)).not.toContain('private');
    expect(exportMediaCacheKey('owner',src,60)).not.toBe(exportMediaCacheKey('owner',src,30));
  });
  it('does not publish a cache manifest or fall back to the broken original after upload failure', async () => {
    const b = backend(); b.runner.upload.mockRejectedValueOnce(new Error('Failed https://storage.example/?signature=secret'));
    await expect(prepareRemotionExportMedia({code:'<Video src="https://example.com/video.mp4"/>',width:1080,height:1920},{userId:'owner',...b}))
      .rejects.toThrow('Export media preparation failed: Failed [URL]');
    expect(b.store.commit).not.toHaveBeenCalled(); expect(b.runner.stop).toHaveBeenCalled();
  });
  it('does not replace an unprepared URL that shares a prepared URL prefix', async () => {
    const b = backend();
    b.runner.prepare.mockResolvedValueOnce(manifest).mockResolvedValueOnce({...manifest,prepared:false});
    const src='https://example.com/video.mp4';
    const original={width:1080,height:1920,code:'function Design(){}',props:{first:src,variant:src+'?version=other'}};
    const result=await prepareRemotionExportMedia(original,{userId:'owner',...b});
    expect(result.design.props?.first).toContain('compatible.mp4');
    expect(result.design.props?.variant).toBe(src+'?version=other');
  });
  it('shares concurrent preparation but signs each caller separately', async () => {
    const b=backend(); let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    b.runner.prepare.mockImplementationOnce(async()=>{await gate;return manifest;});
    const d={width:1080,height:1920,code:'<Video src="https://example.com/concurrent.mp4"/>'};
    const first=prepareRemotionExportMedia(d,{userId:'owner',...b});
    const second=prepareRemotionExportMedia(d,{userId:'owner',...b});
    release(); await Promise.all([first,second]);
    expect(b.runner.prepare).toHaveBeenCalledTimes(1); expect(b.store.renderUrl).toHaveBeenCalledTimes(2);
  });
});
