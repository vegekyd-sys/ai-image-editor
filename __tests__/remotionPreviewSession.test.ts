// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PreviewSessionCache} from '@/lib/remotion-preview-session';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe('owner-scoped preview grace period',()=>{
  it('reuses for 25 seconds and resets the deadline on a completed follow-up',async()=>{
    const create=vi.fn(async()=>({id:1})), stop=vi.fn(async()=>{}), background=vi.fn();
    const pool=new PreviewSessionCache(stop,background);
    const first=pool.acquire('owner:project:sources',create);
    await pool.release('owner:project:sources',first.session,true);
    await vi.advanceTimersByTimeAsync(24_999); expect(stop).not.toHaveBeenCalled();
    const next=pool.acquire('owner:project:sources',create);expect(next.reused).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);expect(stop).not.toHaveBeenCalled();
    await pool.release('owner:project:sources',next.session,true);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(stop).toHaveBeenCalledOnce();expect(create).toHaveBeenCalledOnce();
    expect(pool.acquire('owner:project:sources',create).reused).toBe(false);
  });
  it('keeps owner/project keys and changed source sets separate',()=>{
    const create=vi.fn(async()=>({}));const pool=new PreviewSessionCache(async()=>{},()=>{});
    pool.acquire('alice:A:video1',create);pool.acquire('bob:A:video1',create);pool.acquire('alice:A:video2',create);
    expect(create).toHaveBeenCalledTimes(3);
  });
  it('never stops a VM while another lease is rendering',async()=>{
    const stop=vi.fn(async()=>{}),pool=new PreviewSessionCache(stop,()=>{});
    const a=pool.acquire('a',async()=>({})),b=pool.acquire('a',async()=>({}));
    await pool.release('a',a.session,true);await vi.advanceTimersByTimeAsync(30_000);expect(stop).not.toHaveBeenCalled();
    await pool.release('a',b.session,true);await vi.advanceTimersByTimeAsync(25_000);expect(stop).toHaveBeenCalledOnce();
  });
  it('retires a failed VM immediately and creates a fresh one on retry',async()=>{
    const stop=vi.fn(async()=>{}),pool=new PreviewSessionCache(stop,()=>{}),create=vi.fn(async()=>({}));
    const a=pool.acquire('a',create);await pool.release('a',a.session,false);
    expect(stop).toHaveBeenCalledOnce();expect(pool.acquire('a',create).reused).toBe(false);
  });
  it('falls back to immediate cleanup when the host cannot anchor background work',async()=>{
    const stop=vi.fn(async()=>{}),pool=new PreviewSessionCache(stop,()=>{throw Error('no request');});
    const a=pool.acquire('a',async()=>({}));await pool.release('a',a.session,true);
    expect(stop).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('serializes concurrent work and preserves the queue when a waiting caller cancels',async()=>{
    const pool=new PreviewSessionCache(async()=>{},()=>{}),lease=pool.acquire('a',async()=>({}));
    const calls:string[]=[];let finish!:()=>void;const first=pool.run(lease.session,async()=>{calls.push('first');await new Promise<void>(r=>{finish=r;});},new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    const controller=new AbortController();const cancelled=pool.run(lease.session,async()=>{calls.push('cancelled');},controller.signal).catch(e=>e.message);
    const third=pool.run(lease.session,async()=>{calls.push('third');},new AbortController().signal);
    controller.abort(new Error('cancelled'));expect(await cancelled).toBe('cancelled');expect(calls).toEqual(['first']);
    finish();await Promise.all([first,third]);expect(calls).toEqual(['first','third']);
  });
  it('resumes the owner-scoped disk snapshot after compute is released',async()=>{
    const create=vi.fn(async()=>({id:'base'})),resume=vi.fn(async()=>({id:'restored'})),hibernate=vi.fn(async()=>resume);
    const pool=new PreviewSessionCache(async()=>{},()=>{},25_000,600_000,hibernate);
    const first=pool.acquire('owner:A:media',create);await pool.release('owner:A:media',first.session,true);
    await vi.advanceTimersByTimeAsync(25_000);expect(hibernate).toHaveBeenCalledOnce();
    const next=pool.acquire('owner:A:media',create);expect(await next.session.value).toEqual({id:'restored'});
    expect(create).toHaveBeenCalledOnce();expect(resume).toHaveBeenCalledOnce();
  });
  it('falls back to a fresh runtime if the saved disk snapshot has expired',async()=>{
    const create=vi.fn(async()=>({id:'base'})),resume=vi.fn(async()=>{throw Error('snapshot expired');});
    const pool=new PreviewSessionCache<{id:string}>(async()=>{},()=>{},25_000,600_000,async()=>resume);
    const first=pool.acquire('a',create);await pool.release('a',first.session,true);await vi.advanceTimersByTimeAsync(25_000);
    const next=pool.acquire('a',create);expect(await next.session.value).toEqual({id:'base'});expect(create).toHaveBeenCalledTimes(2);
  });
});
