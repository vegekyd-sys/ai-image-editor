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

async function fixture(options: {hevc?: boolean; fullRange?: boolean; rotate4k?: boolean; fps?: number; undecodableAudio?: boolean; rejectRange?: boolean} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'export-media-test-'));
  cleanups.push(() => rm(root, {recursive: true, force: true}));
  const ffmpeg = await findFfmpeg(), ffprobe = await findFfprobe();
  const source = path.join(root, 'fixture.mp4'), encoded = path.join(root, 'encoded.mp4');
  const size = options.rotate4k ? '3840x2160' : '320x180';
  const rate = options.fps || 60;
  const duration = options.rotate4k ? '0.2' : '1';
  await exec(ffmpeg, ['-v','error','-f','lavfi','-i',`color=c=${options.fullRange?'white':'red'}:s=${size}:r=${rate}:d=${duration}`,
    '-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,
    ...(options.undecodableAudio?['-f','lavfi','-i',`sine=frequency=880:duration=${duration}`,'-map','0:v','-map','1:a','-map','2:a']:[]),
    '-c:v',options.hevc?'libx265':'libx264','-preset','ultrafast',
    ...(options.hevc?['-x265-params','pools=1:frame-threads=1:log-level=error']:[]),
    '-threads','2','-pix_fmt',options.fullRange?'yuv422p10le':'yuv420p',
    ...(options.fullRange?['-vf','scale=out_range=full','-color_range','pc','-color_primaries','bt709','-colorspace','bt709']:[]),'-c:a','aac','-movflags','+faststart',encoded]);
  const modernRotation = options.rotate4k && (await exec(ffmpeg,['-h','full'],{maxBuffer:8*1024**2})).stdout.includes('-display_rotation');
  await exec(ffmpeg, ['-v','error',...(modernRotation?['-display_rotation','90']:[]),'-i',encoded,'-map','0','-c','copy',
    ...(options.rotate4k && !modernRotation?['-metadata:s:v:0','rotate=90']:[]),source]);
  const bytes = await readFile(source);
  let fullDownloads = 0;
  const server = createServer((req, res) => {
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (options.rejectRange && range) {
      res.writeHead(400).end();
      return;
    }
    if (!range) fullDownloads++;
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
  // iPhone APAC spatial audio probes as codec_type=audio, codec_name=unknown and cannot be decoded. ffmpeg cannot
  // author such a track, so the source probe reports the second audio track the way ffprobe reports APAC.
  let probeBinary = ffprobe;
  if (options.undecodableAudio) {
    probeBinary = path.join(root,'ffprobe-apac.cjs');
    await writeFile(probeBinary,`#!${process.execPath}
const {execFileSync} = require('node:child_process');
const args = process.argv.slice(2);
const json = JSON.parse(execFileSync(${JSON.stringify(ffprobe)}, args, {maxBuffer: 4 * 1024 ** 2}));
const target = args[args.length - 1];
if (/^https?:/.test(target) || target.endsWith('source.bin')) {
  const extra = (json.streams || []).filter(s => s.codec_type === 'audio')[1];
  if (extra) Object.assign(extra, {codec_name: 'unknown', codec_tag_string: 'apac'});
}
process.stdout.write(JSON.stringify(json));
`,{mode:0o755});
  }
  async function run(extra: Record<string, unknown> = {}) {
    await writeFile(path.join(work,'request.json'),JSON.stringify({action:'prepare',url,fps:30,timeoutMs:20000,...extra}));
    return exec(process.execPath,[script],{cwd:work,env:{...process.env,FFMPEG_PATH:ffmpeg,FFPROBE_PATH:probeBinary},timeout:25000});
  }
  return {work, source, run, fullDownloads: () => fullDownloads, manifest:async()=>JSON.parse(await readFile(path.join(work,'result.json'),'utf8')) as ExportMediaManifest};
}

describe('export media preparation runtime', () => {
  it('normalizes HEVC/high fps while retaining source duration and audio', async () => {
    const f = await fixture({hevc:true}); await f.run(); const m = await f.manifest();
    expect(m.prepared).toBe(true); expect(m.original.codec).toBe('hevc');
    expect(m.output).toMatchObject({codec:'h264',width:320,height:180,fps:30,audioStreams:1});
    expect(Math.abs(m.output!.duration-m.original.duration)).toBeLessThan(0.15);
    expect(await readdir(f.work)).not.toContain('source.bin');
  },30000);
  it('converts full-range 10-bit 4:2:2 footage to limited-range H.264', async () => {
    const f = await fixture({hevc:true, fullRange:true, fps:50});
    await f.run();
    const manifest = await f.manifest();
    expect(manifest.original).toMatchObject({pixelFormat:'yuv422p10le', colorRange:'pc', fps:50});
    expect(manifest.output).toMatchObject({codec:'h264', pixelFormat:'yuv420p', colorRange:'tv', fps:30, audioStreams:1});
    // White must be rescaled to TV white (235), even if an encoder would accept only changing the range tag.
    const {stdout} = await exec(await findFfmpeg(), ['-v','error','-i',path.join(f.work,'prepared.mp4'),
      '-vf','extractplanes=y,crop=1:1','-frames:v','1','-f','rawvideo','-'], {encoding:'buffer'});
    expect(Math.abs(stdout[0] - 235)).toBeLessThanOrEqual(2);
  },30000);
  it('bakes rotation into the prepared file without reducing original 4K resolution', async () => {
    const f = await fixture({rotate4k:true}); await f.run(); const m = await f.manifest();
    expect(m.original).toMatchObject({width:2160,height:3840});
    expect(m.output).toMatchObject({width:2160,height:3840,fps:30,audioStreams:1});
  },30000);
  it('does not map an undecodable APAC audio track (iPhone spatial audio) into the prepared file', async () => {
    const f = await fixture({hevc:true,undecodableAudio:true}); await f.run(); const m = await f.manifest();
    expect(m.prepared).toBe(true);
    expect(m.original.audioStreams).toBe(1);
    expect(m.output).toMatchObject({codec:'h264',pixelFormat:'yuv420p',audioStreams:1});
    const {stdout} = await exec(await findFfprobe(),['-v','error','-show_entries','stream=codec_type','-of','csv=p=0',path.join(f.work,'prepared.mp4')]);
    expect(stdout.trim().split('\n').filter(t=>t==='audio')).toHaveLength(1);
  },30000);
  it('keeps compatible originals and avoids a full download/transcode', async () => {
    const f = await fixture({fps:30}); await f.run();
    expect(await f.manifest()).toMatchObject({prepared:false,reason:'compatible'});
    expect(f.fullDownloads()).toBe(0);
    expect(await readdir(f.work)).not.toContain('prepared.mp4');
  },30000);
  it('stages a compatible video when the origin rejects Range, preserving decoded frames and audio', async () => {
    const f = await fixture({fps:30,rejectRange:true});
    await f.run();
    expect(await f.manifest()).toMatchObject({prepared:true,reason:'remote-probe-fallback',output:{codec:'h264',width:320,height:180,audioStreams:1}});
    expect(f.fullDownloads()).toBe(1);
    expect(await readdir(f.work)).not.toContain('source.bin');

    const ffmpeg = await findFfmpeg();
    const decode = (file: string) => exec(ffmpeg, ['-v','error','-i',file,'-map','0:v:0','-map','0:a:0','-f','framemd5','-']);
    const [source, staged] = await Promise.all([decode(f.source), decode(path.join(f.work,'prepared.mp4'))]);
    expect(staged.stdout).toBe(source.stdout);
  },30000);
  it('reuses the downloaded source for conversion after a failed remote probe', async () => {
    const f = await fixture({hevc:true,rejectRange:true});
    await f.run();
    expect(await f.manifest()).toMatchObject({prepared:true,original:{codec:'hevc'},output:{codec:'h264',width:320,height:180,audioStreams:1}});
    expect(f.fullDownloads()).toBe(1);
  },30000);
  it('does not transcode ordinary H.264 solely because its fps exceeds composition fps', async () => {
    const f = await fixture({fps:60}); await f.run();
    expect(await f.manifest()).toMatchObject({prepared:false,reason:'compatible'});
  },30000);
  it.each([false, true])('enforces the download budget and redacts URLs (origin rejects Range: %s)', async rejectRange => {
    const f = await fixture({hevc:true,rejectRange});
    const error = await f.run({maxBytes:10}).catch(e=>e);
    expect(error.code).not.toBe(0); expect(error.stderr).not.toContain('private-source-token');
    expect(await readdir(f.work)).not.toContain('source.bin');
    expect(await readdir(f.work)).not.toContain('result.json');
    expect(await readdir(f.work)).not.toContain('prepared.mp4');
  },30000);
});

const manifest: ExportMediaManifest = {prepared:true,bytes:100,original:{codec:'hevc',width:3840,height:2160,fps:60,duration:25,audioStreams:1,hdr:false,alpha:false}};
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
  it('prepares cold sources concurrently with bounded, exclusive runners; warm exports need none', async () => {
    const urls = Array.from({length: 7}, (_, index) => `https://example.com/${index}.mp4`);
    const design = {width: 1080, height: 1920, code: '', props: {clips: urls}};
    const {store} = backend();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen = new Set<string>();
    const stopped = vi.fn();
    const createRunner = vi.fn(async () => {
      let current: string | undefined;
      return {
        async prepare(url: string) {
          expect(current).toBeUndefined();
          current = url;
          seen.add(url);
          await gate;
          return manifest;
        },
        async upload() { expect(current).toBeDefined(); current = undefined; },
        async stop() { expect(current).toBeUndefined(); stopped(); },
      };
    });
    const cold = prepareRemotionExportMedia(design, {userId: 'owner', store, createRunner});
    try {
      await vi.waitFor(() => expect(seen.size).toBe(3));
    } finally {
      release();
    }
    expect((await cold).summary).toMatchObject({prepared: 7, cacheHits: 0, workersUsed: 3});
    expect(seen).toEqual(new Set(urls));
    expect(stopped).toHaveBeenCalledTimes(3);
    const warm = await prepareRemotionExportMedia(design, {userId: 'owner', store, createRunner});
    expect(warm.summary).toMatchObject({prepared: 7, cacheHits: 7, workersUsed: 0});
    expect(createRunner).toHaveBeenCalledTimes(3);
  });
  it('drains in-flight workers on failure and leaves remaining sources unclaimed', async () => {
    const urls = Array.from({length: 5}, (_, index) => `https://example.com/${index}.mp4`);
    const design = {width: 1080, height: 1920, code: '', props: {clips: urls}};
    const {store} = backend();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Set<string>();
    const stopped = vi.fn();
    const createRunner = async () => ({
      async prepare(url: string) {
        started.add(url);
        if (url === urls[0]) throw new Error('transcode failed');
        await gate;
        return manifest;
      },
      async upload() {},
      async stop() { stopped(); },
    });
    const run = prepareRemotionExportMedia(design, {userId: 'owner', store, createRunner});
    const result = expect(run).rejects.toThrow('transcode failed');
    try {
      await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
      expect(started).toEqual(new Set(urls.slice(0, 3)));
    } finally {
      release();
    }
    await result;
    expect(stopped).toHaveBeenCalledTimes(3);
    expect(store.commit).toHaveBeenCalledTimes(2);
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
