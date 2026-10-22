// @vitest-environment node
import {beforeEach,describe,it,expect,vi}from'vitest';
const s=vi.hoisted(()=>({render:vi.fn(),renderSingle:vi.fn(),extract:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/remotion-server',()=>({renderDesignFrames:s.render,renderDesignFrame:s.renderSingle}));
vi.mock('@/lib/video-frame',()=>({extractVideoFrame:s.extract}));
vi.mock('@/lib/workspace',()=>({writeFile:s.write}));
import {createTools}from'@/lib/agent-tools';
let image:Buffer;
beforeEach(async()=>{vi.resetAllMocks();image=await(await import('sharp')).default({create:{width:100,height:200,channels:3,background:'blue'}}).jpeg().toBuffer();s.render.mockResolvedValue([image,image,image]);s.renderSingle.mockResolvedValue(image);s.extract.mockResolvedValue(image);});
function context():any{return {userId:'owner',projectId:'project',snapshotImages:[],currentSnapshotIndex:-1,supabase:{},__runCodeDrafts:[{previewUrl:'https://example.com/previous.jpg'}],__lastDesignPayload:{code:'function Design(){return null}',width:100,height:200,animation:{fps:30,durationInSeconds:20}}};}
function preview(ctx=context()){return createTools(ctx,{spec:{provider:'test',supportsImageInput:true}}as any).preview_frame.execute as any;}
function singlePreview(source:'composition'|'video'){
  const ctx=context();
  if(source==='video'){
    const rows=[{type:'video',video_meta:{videoUrl:'https://example.com/original.mp4',duration:20,fps:30}}];
    const query:any={select:()=>query,eq:()=>query,order:async()=>({data:rows})};
    Object.assign(ctx,{snapshotImages:['https://example.com/original.mp4'],currentSnapshotIndex:0,supabase:{from:()=>query},__lastDesignPayload:undefined});
  }
  return {ctx,execute:preview(ctx)};
}
describe('preview screenshot persistence contract',()=>{
  it('does not report success when an individual frame upload fails',async()=>{
    s.write.mockResolvedValueOnce({success:false,error:'fetch failed'}).mockResolvedValue({success:true,storageUrl:'https://example.com/saved.jpg'});
    const result=await preview()({timestamps:[4,10,16]});expect(result.error).toContain('frame persistence failed');expect(result.workspaceUrl).toBeUndefined();expect(s.write).toHaveBeenCalledTimes(3);
  });
  it('does not report success when only the contact sheet fails',async()=>{
    s.write.mockResolvedValueOnce({success:true,storageUrl:'https://example.com/1.jpg'}).mockResolvedValueOnce({success:true,storageUrl:'https://example.com/2.jpg'}).mockResolvedValueOnce({success:true,storageUrl:'https://example.com/3.jpg'}).mockResolvedValue({success:false,error:'index unavailable'});
    const result=await preview()({timestamps:[4,10,16]});expect(result.error).toContain('contact sheet persistence failed');expect(s.write).toHaveBeenCalledTimes(4);
  });
  it('returns all permanent URLs only after the four writes have succeeded',async()=>{
    s.write.mockResolvedValue({success:true,storageUrl:'https://example.com/saved.jpg'});
    const ctx=context();
    const result=await preview(ctx)({timestamps:[4,10,16]});expect(result.error).toBeUndefined();expect(result.frameUrls).toHaveLength(3);expect(result.workspaceUrl).toBeTruthy();expect(result.base64Data).toBeTruthy();
    const sheet=Buffer.from(result.base64Data,'base64');
    expect(sheet).toEqual(s.write.mock.calls[3][1]);
    expect(await(await import('sharp')).default(sheet).metadata()).toMatchObject({format:'jpeg',width:300,height:234});
    expect(ctx.__workspaceMediaOutputs).toHaveLength(4);
    expect(ctx.__runCodeDrafts[0].previewUrl).toBe(result.workspaceUrl);
  });

  it.each([{success:true},{success:true,storageUrl:''},{success:false,storageUrl:'https://example.com/uncommitted.jpg'}])('rejects an incomplete contact sheet save (%j)',async(write)=>{
    s.write.mockResolvedValue({success:true,storageUrl:'https://example.com/frame.jpg'}).mockResolvedValueOnce({success:true,storageUrl:'https://example.com/1.jpg'}).mockResolvedValueOnce({success:true,storageUrl:'https://example.com/2.jpg'}).mockResolvedValueOnce({success:true,storageUrl:'https://example.com/3.jpg'}).mockResolvedValueOnce(write);
    const ctx=context();
    const result=await preview(ctx)({timestamps:[4,10,16]});
    expect(result.error).toBe('Failed to capture contact sheet: Preview rendered, but contact sheet persistence failed. Preserve this composition; no media regeneration is needed.');
    expect(ctx.__workspaceMediaOutputs).toHaveLength(3);
    expect(ctx.__runCodeDrafts[0].previewUrl).toBe('https://example.com/previous.jpg');
  });

  describe.each(['composition','video']as const)('%s single frame',source=>{
    it('preserves the JPEG bytes and registers the saved media once',async()=>{
      s.write.mockResolvedValue({success:true,storageUrl:'https://example.com/saved.jpg'});
      const {ctx,execute}=singlePreview(source);
      const result=await execute({timestamp:4});
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({source,workspaceUrl:'https://example.com/saved.jpg',mimeType:'image/jpeg'});
      expect(Buffer.from(result.base64Data,'base64')).toEqual(image);
      expect(s.write).toHaveBeenCalledExactlyOnceWith(result.workspacePath,image,ctx.supabase,'owner','image/jpeg');
      expect(ctx.__workspaceMediaOutputs).toEqual([expect.objectContaining({path:result.workspacePath,storageUrl:result.workspaceUrl,contentType:'image/jpeg'})]);
      expect(ctx.__runCodeDrafts[0].previewUrl).toBe(source==='composition'?result.workspaceUrl:'https://example.com/previous.jpg');
    });

    it.each([{success:false,error:'fetch failed'},{success:true},{success:true,storageUrl:''},{success:false,storageUrl:'https://example.com/uncommitted.jpg'}])('preserves the failure response and existing preview (%j)',async(write)=>{
      s.write.mockResolvedValue(write);
      const {ctx,execute}=singlePreview(source);
      const result=await execute({timestamp:4});
      expect(result.error).toBe(source==='composition'
        ?'Failed to capture frame 120: Preview rendered, but screenshot persistence failed. Preserve this composition.'
        :'Failed to extract video frame at 4.00s: Preview rendered, but screenshot persistence failed. Preserve the source video.');
      expect(result.workspaceUrl).toBeUndefined();
      expect(ctx.__workspaceMediaOutputs).toBeUndefined();
      expect(ctx.__runCodeDrafts[0].previewUrl).toBe('https://example.com/previous.jpg');
      expect(s.write).toHaveBeenCalledTimes(1);
    });
  });
});
