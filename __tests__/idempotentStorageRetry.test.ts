import {describe,it,expect,vi,afterEach} from 'vitest';
import {retryIdempotentStorage} from '@/lib/idempotent-storage-retry';
afterEach(()=>vi.useRealTimers());
describe('idempotent storage retry',()=>{
  it('recovers both returned fetch failures and thrown socket timeouts',async()=>{
    vi.useFakeTimers();
    const op=vi.fn().mockResolvedValueOnce({error:{message:'fetch failed'}}).mockRejectedValueOnce(Object.assign(new Error('socket'),{code:'ETIMEDOUT'})).mockResolvedValue({error:null,data:'saved'});
    const result=retryIdempotentStorage(op,'test');await vi.runAllTimersAsync();expect(await result).toEqual({error:null,data:'saved'});expect(op).toHaveBeenCalledTimes(3);
  });
  it('does not retry permission failures or hide an exhausted network error',async()=>{
    const forbidden=vi.fn(async()=>({error:{status:403,message:'Forbidden'}}));expect((await retryIdempotentStorage(forbidden,'test')).error).toBeTruthy();expect(forbidden).toHaveBeenCalledOnce();
    vi.useFakeTimers();const offline=vi.fn(async()=>({error:{message:'TypeError: fetch failed'}}));const result=retryIdempotentStorage(offline,'test');await vi.runAllTimersAsync();expect((await result).error).toBeTruthy();expect(offline).toHaveBeenCalledTimes(3);
  });
});
