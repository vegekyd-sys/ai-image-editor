// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { probeMP4Dimensions } from '@/lib/mp4-probe';
import { probeVideoDimensionsFromUrl } from '@/lib/video-dimensions';
import { box, rotatedMp4, videoTrack } from './helpers/rotatedMp4Fixture';

describe('displayed video dimensions', () => {
  it.each([false,true])('reads upright portrait dimensions from a rotated phone track v1=%s', v1 => {
    for (const angle of [90,270,-90]) expect(probeMP4Dimensions(rotatedMp4(angle,v1))).toEqual({width:1080,height:1920});
    for (const angle of [0,180]) expect(probeMP4Dimensions(rotatedMp4(angle,v1))).toEqual({width:1920,height:1080});
  });
  it('ignores sound tracks even if they have positive dimensions', () => {
    expect(probeMP4Dimensions(box('moov',videoTrack(640,480,0,false,'soun'),videoTrack(2160,3840)))).toEqual({width:2160,height:3840});
  });
  it('never reads outside the track header into another box', () => {
    expect(probeMP4Dimensions(box('moov',box('trak',box('tkhd',Buffer.alloc(10)),videoTrack())))).toBeNull();
    expect(probeMP4Dimensions(rotatedMp4().subarray(0,-10))).toBeNull();
  });
  it('supports extended-size movie boxes', () => {
    const movie=rotatedMp4(), header=Buffer.alloc(16);
    header.writeUInt32BE(1); header.write('moov',4); header.writeBigUInt64BE(BigInt(movie.length+8),8);
    expect(probeMP4Dimensions(Buffer.concat([header,movie.subarray(8)]))).toEqual({width:1080,height:1920});
  });
  it('skips a huge mdat without downloading it, then reads the tail moov', async () => {
    const movie=rotatedMp4(), media=Buffer.alloc(16);media.writeUInt32BE(1);media.write('mdat',4);media.writeBigUInt64BE(BigInt(5000000000),8);
    const fetch=vi.fn(async (_url: any, init: any) => {
      const [,a,b]=/bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;
      const start=Number(a), end=Number(b), bytes=start===0?media:movie.subarray(0,end-start+1);
      return new Response(new Uint8Array(bytes),{status:206,headers:{'content-range':`bytes ${a}-${start+bytes.length-1}/5000001000`}});
    });
    expect(await probeVideoDimensionsFromUrl('https://media.test/movie',fetch as typeof globalThis.fetch)).toEqual({width:1080,height:1920});
    expect(fetch.mock.calls.map(call=>call[1].headers.Range)).toEqual(['bytes=0-65535','bytes=5000000000-5000065535']);
  });
  it('reads adjacent phone headers and a tail movie in three bounded round trips', async () => {
    const file=Buffer.concat([box('ftyp',Buffer.alloc(20)),box('uuid',Buffer.alloc(140)),box('free',Buffer.alloc(130872)),box('mdat',Buffer.alloc(200000)),rotatedMp4()]);
    const fetch=vi.fn(async (_url: any, init: any) => {
      const [,a,b]=/bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;
      const start=Number(a), bytes=file.subarray(start,Number(b)+1);
      return new Response(new Uint8Array(bytes),{status:206,headers:{'content-range':`bytes ${start}-${start+bytes.length-1}/${file.length}`}});
    });
    expect(await probeVideoDimensionsFromUrl('https://media.test/phone',fetch as typeof globalThis.fetch)).toEqual({width:1080,height:1920});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every(call=>Number(call[1].headers.Range.split('-')[1])-Number(call[1].headers.Range.split('=')[1].split('-')[0])<65536)).toBe(true);
  });
  it('supports a small server that ignores Range, without guessing on failure', async () => {
    const fetch=vi.fn(async()=>new Response(new Uint8Array(rotatedMp4())));
    expect(await probeVideoDimensionsFromUrl('https://media.test/movie',fetch)).toEqual({width:1080,height:1920});
    expect(await probeVideoDimensionsFromUrl('file:///secret',fetch)).toBeNull();
    expect(await probeVideoDimensionsFromUrl('https://media.test/movie',async()=>new Response('invalid'))).toBeNull();
  });
  it('rejects a lying Content-Range rather than reading the wrong offset', async () => {
    expect(await probeVideoDimensionsFromUrl('https://media.test/movie',async()=>new Response(new Uint8Array(rotatedMp4()),{status:206,headers:{'content-range':'bytes 20-35/1000'}}))).toBeNull();
  });
});
