import {describe,it,expect,vi} from 'vitest';
import type {Sandbox} from '@vercel/sandbox';
import {awaitPreviewOperation,runPreviewCommand} from '@/lib/remotion-preview-command';

describe('bounded preview command lifecycle', () => {
  it('finishes without opening a potentially stranded log stream', async () => {
    const logs=vi.fn(() => new Promise(() => undefined));
    const wait=vi.fn(async () => ({exitCode:0}));
    const sandbox={runCommand:vi.fn(async()=>({wait,logs,kill:vi.fn()}))} as unknown as Sandbox;
    await runPreviewCommand(sandbox, ['render-still.mjs'], new AbortController().signal);
    expect(logs).not.toHaveBeenCalled();expect(wait).toHaveBeenCalledOnce();
  });
  it('kills a command and returns when the remote wait ignores cancellation', async () => {
    const kill=vi.fn(async()=>undefined);
    const sandbox={runCommand:vi.fn(async()=>({wait:()=>new Promise(()=>undefined),kill}))} as unknown as Sandbox;
    const controller=new AbortController();
    const result=runPreviewCommand(sandbox,['prefetch'],controller.signal);
    await new Promise(resolve=>setTimeout(resolve,10));controller.abort(new Error('deadline'));
    await expect(result).rejects.toThrow('deadline');expect(kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('kills a process created after the start RPC was cancelled', async () => {
    let finish!: (value:unknown)=>void;
    const kill=vi.fn(async()=>undefined);
    const sandbox={runCommand:()=>new Promise(resolve=>{finish=resolve;})} as unknown as Sandbox;
    const controller=new AbortController();
    const result=runPreviewCommand(sandbox,['prefetch'],controller.signal);
    controller.abort(new Error('stopped'));await expect(result).rejects.toThrow('stopped');
    finish({kill});await Promise.resolve();expect(kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('bounds a stalled shared queue and redacts provider errors', async () => {
    const controller=new AbortController();
    const queued=awaitPreviewOperation(new Promise(()=>undefined),controller.signal);
    controller.abort(new Error('queue timeout'));await expect(queued).rejects.toThrow('queue timeout');
    const sandbox={runCommand:async()=>({wait:async()=>({exitCode:1,stderr:async()=> 'Fetch failed https://example.com/a.mp4?access=secret'}),kill:async()=>undefined})} as unknown as Sandbox;
    const failed=runPreviewCommand(sandbox,['prefetch'],new AbortController().signal);
    await expect(failed).rejects.toThrow('Fetch failed [URL]');
    await expect(failed).rejects.not.toThrow('secret');
  });
});
