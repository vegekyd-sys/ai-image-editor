// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignPayload } from '@/types';

const state = vi.hoisted(() => ({create: vi.fn(), renderVideo: vi.fn()}));
vi.mock('@vercel/sandbox', () => ({Sandbox: {create: state.create}}));
vi.mock('@remotion/vercel', () => ({renderMediaOnVercel: state.renderVideo}));
vi.mock('@/lib/remotion-font-resolver', () => ({resolveRemotionFontManifestUrlForDesign: async () => ''}));
import { renderDesignFrame, renderDesignFrames, renderDesignVideo } from '@/lib/remotion-server';

const design = {code:'function Design(){return null;}',width:1080,height:1920,props:{},animation:{fps:30,durationInSeconds:10}} as DesignPayload;
function sandbox() {
  return {
    sandboxId: 'test-sandbox',
    stop: vi.fn(async () => undefined),
    writeFiles: vi.fn(async () => undefined),
    readFileToBuffer: vi.fn(async () => Buffer.from('jpeg')),
    runCommand: vi.fn(async () => ({kill:vi.fn(),wait:async()=>({exitCode:0})})),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REMOTION_SNAPSHOT_ID','test-snapshot');
  vi.stubEnv('REMOTION_RENDERER','sandbox');
  vi.stubEnv('REMOTION_SANDBOX_VCPUS','');
  vi.stubEnv('REMOTION_PREVIEW_SANDBOX_VCPUS','');
});
afterEach(() => vi.unstubAllEnvs());

describe('Remotion operation-scoped Sandbox lifecycle', () => {
  it('stops on success and does not retain a paid VM between independent calls', async () => {
    const first=sandbox(), second=sandbox();
    state.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await renderDesignFrame(design);
    expect(first.stop).toHaveBeenCalledOnce();
    await renderDesignFrame(design);
    expect(second.stop).toHaveBeenCalledOnce();
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({resources:{vcpus:2}}));
  });
  it('keeps sequential contact-sheet frames and their source download in one VM', async () => {
    const box=sandbox(); state.create.mockResolvedValue(box);
    const video={...design,code:"function Design(){return React.createElement(Video,{src:'https://example.com/clip.mp4'});}"};
    const result=await renderDesignFrames(video,[0,30,90]);
    expect(result).toHaveLength(3);
    expect(state.create).toHaveBeenCalledOnce();
    expect(box.writeFiles).toHaveBeenCalledOnce();
    expect(box.runCommand).toHaveBeenCalledTimes(4); // one prefetch, three frames
    expect(box.stop).toHaveBeenCalledOnce();
  });
  it('stops failed renders', async () => {
    const box=sandbox(); state.create.mockResolvedValue(box);
    box.readFileToBuffer.mockRejectedValue(new Error('read failed'));
    await expect(renderDesignFrame(design)).rejects.toThrow('read failed');
    expect(box.stop).toHaveBeenCalledOnce();
  });
  it('stops a cancelled in-flight frame and returns its cancellation reason', async () => {
    const box=sandbox(), controller=new AbortController(); state.create.mockResolvedValue(box);
    box.readFileToBuffer.mockImplementation(async()=>{
      controller.abort(new Error('user cancelled'));
      return new Promise<never>(()=>undefined);
    });
    await expect(renderDesignFrame(design,0,{signal:controller.signal})).rejects.toThrow('user cancelled');
    expect(box.stop).toHaveBeenCalledOnce();
  });
  it('cleans up an expired VM before retrying with a fresh one', async () => {
    const first=sandbox(), second=sandbox();
    first.readFileToBuffer.mockRejectedValue(new Error('410 gone'));
    state.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await renderDesignFrame(design);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(state.create).toHaveBeenCalledTimes(2);
  });
  it('cleans up a create RPC that resolves after the caller cancels', async () => {
    const box=sandbox(), controller=new AbortController();
    state.create.mockImplementationOnce(async()=>{
      controller.abort(new Error('cancelled during create'));
      await new Promise(resolve=>setTimeout(resolve,10));
      return box;
    });
    await expect(renderDesignFrame(design,0,{signal:controller.signal})).rejects.toThrow('cancelled during create');
    expect(box.stop).toHaveBeenCalledOnce();
  });
  it('does not discard a captured image when the stop service fails', async () => {
    const box=sandbox(); state.create.mockResolvedValue(box);
    box.stop.mockRejectedValue(new Error('stop service unavailable'));
    await expect(renderDesignFrame(design)).resolves.toEqual(Buffer.from('jpeg'));
    expect(state.create).toHaveBeenCalledOnce();
  });
  it('preserves export capacity, stops after reading the MP4, and supports a preview-only override', async () => {
    const box=sandbox(); state.create.mockResolvedValue(box);
    state.renderVideo.mockResolvedValue({sandboxFilePath:'/tmp/test.mp4'});
    vi.stubEnv('REMOTION_PREVIEW_SANDBOX_VCPUS','4');
    await renderDesignVideo(design);
    expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({resources:{vcpus:8}}));
    expect(box.stop).toHaveBeenCalledOnce();
    await renderDesignFrame(design);
    expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({resources:{vcpus:4}}));
  });
});
