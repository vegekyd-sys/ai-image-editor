// @vitest-environment node
import {beforeEach,describe,it,expect,vi}from'vitest';
const s=vi.hoisted(()=>({render:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/remotion-server',()=>({renderDesignFrames:s.render}));
vi.mock('@/lib/workspace',()=>({writeFile:s.write}));
import {createTools}from'@/lib/agent-tools';
let image:Buffer;
beforeEach(async()=>{vi.clearAllMocks();image=await(await import('sharp')).default({create:{width:100,height:200,channels:3,background:'blue'}}).jpeg().toBuffer();s.render.mockResolvedValue([image,image,image]);});
function preview(){const ctx:any={userId:'owner',projectId:'project',snapshotImages:[],currentSnapshotIndex:-1,supabase:{},__lastDesignPayload:{code:'function Design(){return null}',width:100,height:200,animation:{fps:30,durationInSeconds:20}}};return createTools(ctx,{spec:{provider:'test',supportsImageInput:true}}as any).preview_frame.execute as any;}
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
    const result=await preview()({timestamps:[4,10,16]});expect(result.error).toBeUndefined();expect(result.frameUrls).toHaveLength(3);expect(result.workspaceUrl).toBeTruthy();expect(result.base64Data).toBeTruthy();
  });
});
