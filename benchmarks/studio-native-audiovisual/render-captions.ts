/** Caption-only comparison over accepted native audiovisual footage. Local
 * Remotion render + editable Makaron source; never generates voice/music.
 * Usage: ... render-captions.ts <private-dir> <case-label>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { buildNarrationCueSheet } from '../../src/lib/narration-cues';

const phrases = [
  'Meet the TT04S —', 'a stainless-steel range hood', 'built for hard-working kitchens.',
  'Its 900-by-480 canopy', 'covers more of your hob,', 'so smoke never gets away.',
  'Three stainless-steel filters', 'wash clean again and again —', 'no replacements, ever.',
  'An iron fan and housing outlast plastic,', 'with a sealed 180-watt motor', 'and a 3-year warranty.',
  'Oil drains into the cup;', 'add carbon filters for duct-free air.', 'TT04S — cleaner air, easier living.',
];
async function main() {
  const root = path.resolve(process.argv[2]);
  const name = process.argv[3];
  if (!name) throw new Error('Expected private-dir case-label');
  const source = path.join(root, name + '.mp4');
  const status = JSON.parse(fs.readFileSync(path.join(root, name + '.status.json'), 'utf8'));
  if (!fs.existsSync(source) || status.status !== 'completed') throw new Error('Wait for the actual Eco final video; do not render against a pending task.');
  const transcript = JSON.parse(fs.readFileSync(path.join(root, name + '.asr.json'), 'utf8'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { encoding: 'utf8' }));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')) throw new Error('The source has no audio.');
  const [n, d] = video.r_frame_rate.split('/').map(Number);
  const fps = n / d;
  const frames = Number(video.nb_frames) || Math.round(Number(video.duration) * fps);
  const sheet = buildNarrationCueSheet({ transcript, sections: phrases.map((text, i) => ({ id: 'caption-' + i, text })), fps });
  const captions = sheet.cues.map(c => ({ text: c.expectedText, startMs: c.startSeconds * 1000, endMs: c.endSeconds * 1000, timestampMs: null, confidence: null }));
  const dir = path.join(root, name + '-overlay');
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.copyFileSync(source, path.join(dir, 'public', 'source.mp4'));
  const code = `function Composition(props) {
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),ms=frame/fps*1000;
 const cue=props.captions.find(c=>ms>=c.startMs&&ms<c.endMs);
 return <AbsoluteFill style={{backgroundColor:'black',fontFamily:'Arial,"PingFang SC",sans-serif'}}>
  <OffthreadVideo src={props.videoUrl} volume={1} style={{width:'100%',height:'100%',objectFit:'contain'}}/>
  <div style={{position:'absolute',top:40,right:48,color:'white',fontWeight:700,fontSize:34,textShadow:'0 2px 8px #000'}}>{props.modelLabel}</div>
  {cue&&<div style={{position:'absolute',bottom:145,left:36,right:36,display:'flex',justifyContent:'center'}}><div style={{color:'white',fontSize:props.captionFontSize,lineHeight:1.25,textAlign:'center',backgroundColor:'rgba(0,0,0,.55)',borderRadius:5,padding:'8px 14px',maxWidth:'100%'}}>{cue.text}</div></div>}
  {ms>=props.companyStartMs&&<div style={{position:'absolute',bottom:65,left:30,right:30,color:'white',fontSize:24,fontWeight:500,textAlign:'center',textShadow:'0 2px 8px #000'}}>{props.companyName}</div>}
 </AbsoluteFill>;
}`;
  const props = { videoUrl: status.videoUrl, captions, modelLabel: 'TT04S', companyName: '中山市沪颖电器有限公司', companyStartMs: 22_000, captionFontSize: 30 };
  const design = { type: 'render', code, width: video.width, height: video.height, props, animation: { fps, durationInSeconds: frames / fps } };
  fs.writeFileSync(path.join(dir, 'editable.json'), JSON.stringify(design, null, 2));
  fs.writeFileSync(path.join(dir, 'captions.json'), JSON.stringify(captions, null, 2));
  fs.writeFileSync(path.join(dir, 'speech-clock.json'), JSON.stringify(sheet, null, 2));
  const entry = path.join(dir, 'entry.tsx');
  fs.writeFileSync(entry, `import React from 'react';import {registerRoot,Composition as RegisteredComposition,AbsoluteFill,OffthreadVideo,useCurrentFrame,useVideoConfig,staticFile} from 'remotion';\n${code}\nregisterRoot(()=> <RegisteredComposition id="Captions" component={Composition} width={${video.width}} height={${video.height}} fps={${fps}} durationInFrames={${frames}} defaultProps={{...${JSON.stringify(props)},videoUrl:staticFile('source.mp4')}}/>);`);
  const started = Date.now();
  const serveUrl = await bundle({ entryPoint: entry, publicDir: path.join(dir, 'public'), onProgress: () => {} });
  const composition = await selectComposition({ serveUrl, id: 'Captions' });
  await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: path.join(dir, 'rendered.mp4'), concurrency: 2 });
  // Keep the accepted original soundtrack without a second lossy audio pass.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'rendered.mp4'), '-i', source, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', path.join(dir, 'final.mp4')]);
  await renderStill({ serveUrl, composition, frame: Math.round(2 * fps), output: path.join(dir, 'preview.png') });
  await renderStill({ serveUrl, composition, frame: Math.round(2 * fps), inputProps: { ...props, videoUrl: composition.props.videoUrl, modelLabel: 'TT04S · EDIT CHECK' }, output: path.join(dir, 'props-edited.png') });
  const pcm = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-'], { maxBuffer: 20 * 1024 * 1024 });
  if (!pcm(source).equals(pcm(path.join(dir, 'final.mp4')))) throw new Error('Caption overlay changed decoded source audio.');
  const result = { runtime: 'remotion', studioRuns: 0, audioGenerations: 0, audioUnchanged: true, frames, fps, captions: captions.length, width: video.width, height: video.height, elapsedMs: Date.now() - started, output: path.join(dir, 'final.mp4'), editable: path.join(dir, 'editable.json'), propsPatchRendered: true };
  fs.writeFileSync(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exitCode = 1; });
