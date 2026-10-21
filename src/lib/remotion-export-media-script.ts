/** Runs in the disposable media VM (or the local worker), never in the Lambda renderer. */
export const EXPORT_MEDIA_PREPARATION_SCRIPT = String.raw`
(async () => {
const fs = require('node:fs/promises');
const {createReadStream, createWriteStream} = require('node:fs');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
const exec = promisify(execFile);
const root = process.cwd();
const config = JSON.parse(await fs.readFile(path.join(root, 'request.json'), 'utf8'));
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs || 240000)]);
const input = path.join(root, 'source.bin');
const output = path.join(root, 'prepared.mp4');
const manifestFile = path.join(root, 'result.json');
const maxBytes = config.maxBytes || 2 * 1024 ** 3;
const reserveBytes = 512 * 1024 ** 2;
function binary(name, packageName) {
  if (name === 'ffmpeg' && process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (name === 'ffprobe' && process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  try { const p = require(packageName); return typeof p === 'string' ? p : p.path; } catch { return name; }
}
const ffmpeg = binary('ffmpeg', 'ffmpeg-static');
const ffprobe = binary('ffprobe', 'ffprobe-static');
async function probe(file, remote = false) {
  const {stdout} = await exec(ffprobe, ['-v','error','-protocol_whitelist',remote ? 'http,https,tcp,tls,crypto' : 'file,pipe',
    '-show_format','-show_streams','-of','json',file], {signal,timeout:30000,maxBuffer:4*1024**2});
  const result = JSON.parse(stdout);
  const streams = result.streams || [];
  const v = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!v || !v.width || !v.height) throw new Error('Video metadata unavailable');
  const rate = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
  const rotation = Number((v.side_data_list || []).find(s => s.rotation !== undefined)?.rotation || v.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  return {codec:v.codec_name,pixelFormat:v.pix_fmt,width:rotated?v.height:v.width,height:rotated?v.width:v.height,
    fps:rate[1] ? rate[0]/rate[1] : rate[0],duration:Number(result.format?.duration || v.duration),
    bitrate:Number(v.bit_rate || result.format?.bit_rate || 0),audioStreams:streams.filter(s=>s.codec_type==='audio').length,
    hdr:['smpte2084','arib-std-b67'].includes(v.color_transfer),
    alpha:/^(yuva|gbrap|rgba|bgra|argb|abgr)/.test(v.pix_fmt || '') || v.tags?.alpha_mode === '1'
      || streams.filter(s=>s.codec_type==='video' && !s.disposition?.attached_pic).length > 1};
}
async function download(url) {
  const disk = await fs.statfs(root);
  const budget = Math.min(maxBytes, Number(disk.bavail) * Number(disk.bsize) - reserveBytes);
  if (budget <= 0) throw new Error('Insufficient temporary disk for export media preparation');
  const response = await fetch(url,{signal});
  if (!response.ok || !response.body) throw new Error('Source HTTP ' + response.status);
  const declared = Number(response.headers.get('content-length'));
  if (declared > budget) { await response.body.cancel(); throw new Error('Source exceeds export media disk budget'); }
  let bytes = 0;
  const limit = new Transform({transform(chunk,encoding,done) {
    bytes += chunk.length;
    done(bytes > budget ? new Error('Source exceeds export media disk budget') : null,chunk);
  }});
  await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(input),{signal});
  if (!bytes || (declared > 0 && bytes !== declared)) throw new Error('Incomplete source download');
}
try {
  if (config.action === 'upload') {
    const stat = await fs.stat(output);
    const response = await fetch(config.uploadUrl,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(stat.size)},
      body:Readable.toWeb(createReadStream(output)),duplex:'half',signal});
    if (!response.ok) throw new Error('Prepared media upload HTTP ' + response.status);
    await response.body?.cancel();
  } else {
    await fs.rm(input,{force:true}); await fs.rm(output,{force:true}); await fs.rm(manifestFile,{force:true});
    // A remote metadata read uses Range; ordinary H.264 sources need no full download/transcode.
    const original = await probe(config.url,true);
    const targetFps = Math.min(original.fps || config.fps, config.fps);
    const highResolution = original.width * original.height >= 3840 * 2160;
    const needsPreparation = !original.alpha && (original.codec !== 'h264' || original.pixelFormat !== 'yuv420p'
      || (highResolution && original.fps > config.fps + 0.1) || original.bitrate > 50000000);
    if (!needsPreparation) {
      await fs.writeFile(manifestFile,JSON.stringify({prepared:false,original,reason:original.alpha?'preserve-alpha':'compatible'}));
    } else {
      await download(config.url);
      const local = await probe(input);
      if (local.codec !== original.codec || local.width !== original.width || local.height !== original.height
        || !Number.isFinite(local.duration) || local.duration <= 0) throw new Error('Source changed while preparing export');
      const disk = await fs.statfs(root);
      const outputBudget = Math.min(maxBytes,Number(disk.bavail)*Number(disk.bsize)-reserveBytes);
      if (outputBudget <= 0) throw new Error('Insufficient temporary disk for prepared media');
      const filters = [];
      if (original.hdr) filters.push('zscale=t=linear:npl=100','format=gbrpf32le','tonemap=tonemap=hable:desat=0','zscale=p=bt709:t=bt709:m=bt709:r=tv');
      filters.push('fps='+targetFps,'pad=ceil(iw/2)*2:ceil(ih/2)*2','format=yuv420p');
      const args = ['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,
        '-map','0:V:0','-map','0:a?','-vf',filters.join(','),'-c:v','libx264','-preset','veryfast','-crf','18',
        '-g',String(Math.max(1,Math.round(targetFps))),'-keyint_min','1','-sc_threshold','0','-threads','4',
        '-c:a','aac','-b:a','192k','-map_metadata','-1','-movflags','+faststart','-fs',String(Math.floor(outputBudget))];
      if (original.hdr) args.push('-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709');
      await exec(ffmpeg,[...args,output],{signal,timeout:config.timeoutMs||240000,maxBuffer:1024**2});
      const prepared = await probe(output);
      const bytes = (await fs.stat(output)).size;
      if (!bytes || bytes > outputBudget || prepared.codec !== 'h264' || prepared.pixelFormat !== 'yuv420p'
        || prepared.width !== Math.ceil(original.width/2)*2 || prepared.height !== Math.ceil(original.height/2)*2
        || prepared.audioStreams !== original.audioStreams || Math.abs(prepared.duration-original.duration) > Math.max(0.15,2/targetFps)) {
        throw new Error('Prepared media failed dimensions, audio or duration validation');
      }
      // Validate the complete file, not just its first packet / metadata.
      await exec(ffmpeg,['-v','error','-xerror','-protocol_whitelist','file,pipe','-i',output,'-f','null','-'],
        {signal,timeout:config.timeoutMs||240000,maxBuffer:1024**2});
      await fs.writeFile(manifestFile,JSON.stringify({prepared:true,original,output:prepared,bytes}));
    }
  }
} catch (error) {
  await fs.rm(output,{force:true}); await fs.rm(manifestFile,{force:true});
  console.error(signal.aborted?'Export media preparation timed out or was cancelled':
    String(error.message || 'Export media preparation failed').replace(/https?:\/\/[^\s"'<>]+/g,'[URL]').slice(0,600));
  process.exitCode = 1;
} finally { await fs.rm(input,{force:true}); }
})().catch(() => { console.error('Export media worker could not initialize'); process.exitCode = 1; });
`;
