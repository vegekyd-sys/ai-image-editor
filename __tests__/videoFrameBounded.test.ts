// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
const mocks=vi.hoisted(()=>({exec:vi.fn(),local:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:mocks.exec}));
vi.mock('@/lib/ffmpeg-runtime',()=>({findFfmpeg:async()=>'/ffmpeg'}));
vi.mock('@/lib/video-retake-media',()=>({extractRetakeSourceFrames:mocks.local}));
import {extractVideoFrame,extractVideoFrames,MAX_PREVIEW_SOURCE_BYTES} from '@/lib/video-frame';
describe('bounded video previews',()=>{
 beforeEach(()=>{
  vi.restoreAllMocks();mocks.exec.mockReset();mocks.local.mockReset();
  mocks.exec.mockImplementation((_binary,args,_options,callback)=>{
   void writeFile(args.at(-1),Buffer.from('jpeg')).then(()=>callback(null,{stdout:'',stderr:''}));
  });
 });
 it('downloads a small source once and shares the measured tail across the entire batch',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('video',{headers:{'Content-Length':'5'}}));
  mocks.local.mockResolvedValue([Buffer.from('a'),Buffer.from('b')]);
  const frames=await extractVideoFrames('https://example.com/video.mp4',[1,4]);
  expect(fetch).toHaveBeenCalledTimes(1);expect(mocks.local).toHaveBeenCalledTimes(1);
  expect(mocks.local.mock.calls[0].slice(0,3)).toEqual([Buffer.from('video'),[1,4],4]);
  expect(frames.map(f=>f.toString())).toEqual(['a','b']);expect(mocks.exec).not.toHaveBeenCalled();
 });
 it('cancels a declared 1GB body without reading it and performs serial remote seeks',async()=>{
  const pull=vi.fn();const cancel=vi.fn();
  const body=new ReadableStream({pull,cancel},{highWaterMark:0});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body,{headers:{'Content-Length':'1006856019'}}));
  const frames=await extractVideoFrames('https://example.com/source.mp4',[103,110]);
  expect(pull).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();
  expect(frames).toHaveLength(2);expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(mocks.exec.mock.calls[0][1]).toContain('103');expect(mocks.exec.mock.calls[1][1]).toContain('110');
  expect(mocks.exec.mock.calls[0][2].timeout).toBe(45000);
 });
 it('bounds a chunked response without trusting an absent Content-Length',async()=>{
  const cancel=vi.fn();const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PREVIEW_SOURCE_BYTES+1));},cancel},{highWaterMark:0});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(stream));
  await extractVideoFrame('https://example.com/unknown.mp4',{timestamp:3});
  expect(cancel).toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();expect(mocks.exec).toHaveBeenCalledTimes(1);
 });
 it('does not expose signed source URLs when FFmpeg fails',async()=>{
  const secret='https://example.com/source?access=private-value';
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('x',{headers:{'Content-Length':'1000000000'}}));
  mocks.exec.mockImplementation((_b,_a,_o,cb)=>cb(new Error('command '+secret)));
  await expect(extractVideoFrame(secret)).rejects.toThrow('Remote video frame extraction failed');
  try{await extractVideoFrame(secret);}catch(error){expect(String(error)).not.toContain('private-value');}
 });
 it('aborts before touching the source after the Agent is stopped',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch');const c=new AbortController();c.abort();
  await expect(extractVideoFrame('https://example.com/video.mp4',{signal:c.signal})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
 });
});
