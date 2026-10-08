// @vitest-environment node
import {expect,it,vi} from 'vitest';
const stubs=vi.hoisted(()=>({extract:vi.fn(),read:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/video-frame',()=>({extractVideoFrame:stubs.extract}));
vi.mock('@/lib/workspace',()=>({readFile:stubs.read,writeFile:stubs.write}));
import {createTools} from '@/lib/agent-tools';
it('inspects a targeted source video even when it has a published composition and a cached draft',async()=>{
  const sharp=(await import('sharp')).default;
  const image=await sharp({create:{width:320,height:240,channels:3,background:'blue'}}).jpeg().toBuffer();
  stubs.extract.mockResolvedValue(image);stubs.write.mockResolvedValue({storageUrl:'https://example.com/frame.jpg'});
  const rows=[{type:'video',design_path:'code/old-overlay.json',video_meta:{videoUrl:'https://example.com/original.mp4',duration:30.05,fps:30}}];
  const query:any={select:()=>query,eq:()=>query,order:async()=>({data:rows})};
  const ctx:any={userId:'owner',projectId:'project',snapshotImages:['https://example.com/original.mp4'],currentSnapshotIndex:0,explicitMediaIndices:[1],supabase:{from:()=>query},__lastDesignPayload:{code:'old Remotion code',animation:{durationInSeconds:30,fps:30}}};
  const tool=createTools(ctx,{spec:{provider:'openrouter',supportsImageInput:true}} as any).preview_frame;
  const result:any=await(tool.execute as any)({media_index:1,timestamps:[27.5,29.5]});
  expect(result.source).toBe('video-contact-sheet');
  expect(stubs.extract).toHaveBeenCalledWith('https://example.com/original.mp4',{timestamp:27.5});
  expect(stubs.read).not.toHaveBeenCalled();
});
