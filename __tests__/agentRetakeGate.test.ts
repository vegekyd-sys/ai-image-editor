// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectedRetakeVideoTool } from '@/lib/agent-retake-tool'
import { signRetakeInspection } from '@/lib/video-retake-inspection'

const submit = vi.hoisted(() => vi.fn(async (_input?: unknown, _context?: unknown) => ({ success: false, message: 'test submission recorded' })))
afterEach(() => { vi.unstubAllEnvs(); submit.mockClear() })

const sourceUrl = 'https://example.com/original.mp4'
const ctx = { userId: 'owner', projectId: 'project', snapshotImages: [sourceUrl,'https://example.com/air.jpg'], agentRunId: 'run' }
const scope = { ctx, submit, resolveSource: async () => ({ videoUrl: sourceUrl }), serializeVideoSubmission: async (operation: () => Promise<unknown>) => operation() } as any
const input = { camera_change:true, media_index: 1, start: 18, end: 21, model: 'fal-h3-max', prompt: '1–2s: wheel close-up. CUT. 2–4s: overhead airborne motion.',
  shot_plan: [{ start: 1, end: 2, instruction: 'wheel close-up' }, { start: 2, end: 4, instruction: 'overhead airborne motion' }] }
const observation = 'A white box-headed robot is already airborne above an orange skateboard in the purple-lit skatepark.'
const receipt = () => signRetakeInspection({ userId: 'owner', projectId: 'project', runId: 'run', inputEpoch: 0,
  sourceUrl, start: 18, end: 21, model: 'fal-h3-max' }, 'test-server-secret', { outputSelection: { start: 1, end: 4 }, generationDuration: 5 })

describe('Agent Retake paid-submission gate', () => {
  it('selects new audio without changing the visual endpoint intent',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,edit_mode:'modify',audio_mode:'generated',inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({retake:{start:18,end:21,audioMode:'generated',editMode:'modify',cameraChange:true}}),expect.anything());
  });
  it('binds inspected corrected boundary images without relaxing modify endpoint intent',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    const refs={...scope,ctx:{...ctx,snapshotImages:[sourceUrl,'https://example.com/open.jpg','https://example.com/close.jpg']}};
    await (createInspectedRetakeVideoTool(refs).execute as any)({...input,edit_mode:'modify',camera_change:false,prompt:'Retain <<<media_1>>> action with corrected opening <<<media_2>>> and closing <<<media_3>>>.',shot_plan:[{start:1,end:4,instruction:'Retain action with corrected endpoints'}],inspection_id:receipt(),source_observation:observation,corrected_boundary_media_indices:{start:2,end:3}});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({script:'Retain the inspected original scene action with corrected opening Image 1 and closing Image 2.',images:[],retake:{start:18,end:21,editMode:'modify',correctedBoundaries:{startUrl:'https://example.com/open.jpg',endUrl:'https://example.com/close.jpg'}}}),expect.anything());
  });
  it.each([{edit_mode:'replace'},{model:'seedance-2.5-eco'},{end_frame_media_index:2}])('rejects incompatible corrected boundary controls before submission %j',async change=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    const result=await (createInspectedRetakeVideoTool(scope).execute as any)({...input,edit_mode:'modify',inspection_id:receipt(),source_observation:observation,corrected_boundary_media_indices:{start:2,end:3},...change});
    expect(result.success).toBe(false);expect(submit).not.toHaveBeenCalled();
  });
  it.each(['seedance-2.5-eco','seedance-2.5'])('repairs unsupported native controls without discarding modification intent for %s',async model=>{
    const execute=createInspectedRetakeVideoTool(scope).execute as any;
    for(const controls of [{corrected_boundary_media_indices:{start:2,end:3}},{middle_frame_media_index:2,middle_frame_time:2.5}]) {
      const result=await execute({...input,model,edit_mode:'modify',...controls});
      expect(result).toMatchObject({success:false,errorCode:'retake_controls_unsupported',repair:{model,edit_mode:'modify',omit:Object.keys(controls)}});
      expect(submit).not.toHaveBeenCalled();
    }
  });
  it.each(['creative','middle','ending'])('resolves a persisted same-turn %s image despite a stale data URL',async role=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    const query:any={select:()=>query,eq:()=>query,order:async()=>({data:[{type:'video',video_meta:{}},{type:null,image_url:'https://example.com/ready.jpg'}]})};
    const freshScope={...scope,ctx:{...ctx,snapshotImages:[sourceUrl,'data:image/png;base64,AAAA'],supabase:{from:()=>query}}};
    const refs=role==='creative' ? {reference_media_indices:[2]} : role==='middle' ? {middle_frame_media_index:2,middle_frame_time:2.5} : {end_frame_media_index:2};
    await (createInspectedRetakeVideoTool(freshScope).execute as any)({...input,prompt:input.prompt+' Use <<<media_2>>> as the checked visual state.',inspection_id:receipt(),source_observation:observation,...refs});
    expect(submit).toHaveBeenCalledTimes(1);
    const call:any=submit.mock.calls[0][0];
    expect(role==='creative' ? call.images[0] : role==='middle' ? call.retake.middleFrame.imageUrl : call.retake.endFrame.imageUrl).toBe('https://example.com/ready.jpg');
  });
  it('rejects a video poster as a native middle image before submission',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    const query:any={select:()=>query,eq:()=>query,order:async()=>({data:[{type:'video'},{type:'video',image_url:'https://example.com/poster.jpg'}]})};
    const result=await (createInspectedRetakeVideoTool({...scope,ctx:{...ctx,supabase:{from:()=>query}}}).execute as any)({...input,inspection_id:receipt(),source_observation:observation,middle_frame_media_index:2,middle_frame_time:2.5});
    expect(result.success).toBe(false);expect(submit).not.toHaveBeenCalled();
  });
  it('preserves endpoints for a modification even with camera changes',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,edit_mode:'modify',inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({retake:{start:18,end:21,cameraChange:true,editMode:'modify'}}),expect.anything());
  });
  it('unlocks original endpoints for replacement independently of camera_change',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,edit_mode:'replace',camera_change:false,inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({retake:{start:18,end:21,boundaryMode:'scene',editMode:'replace'}}),expect.anything());
  });
  it('rejects a conflicting legacy override without charging',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    const result=await (createInspectedRetakeVideoTool(scope).execute as any)({...input,edit_mode:'modify',boundary_mode:'scene',inspection_id:receipt(),source_observation:observation});
    expect(result).toMatchObject({success:false,errorCode:'retake_edit_mode_conflict'});
    expect(submit).not.toHaveBeenCalled();
  });
  it('carries scene continuity through inspection, source-marker binding and normal submission',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,camera_change:false,boundary_mode:'scene',prompt:'Replace <<<media_1>>> with a sustained tighter shot.',shot_plan:[{start:1,end:4,instruction:'Sustained tighter shot'}],inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({script:'Replace the inspected original scene with a sustained tighter shot.',retake:{start:18,end:21,boundaryMode:'scene'}}),expect.anything());
  });
  it('does not reserve or submit without actual inspection evidence', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    const result = await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, source_observation: observation })
    expect(result).toMatchObject({ success: false, errorCode: 'retake_inspection_required' })
    expect(submit).not.toHaveBeenCalled()
  })
  it('does not submit a different range or a receipt without scene understanding', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, start: 19, inspection_id: receipt(), source_observation: observation })
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, inspection_id: receipt() })
    expect(submit).not.toHaveBeenCalled()
  })
  it('submits the inspected Agent prompt unchanged through the normal billing path', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, inspection_id: receipt(), source_observation: observation, middle_frame_media_index:2,middle_frame_time:2.5 })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ script: input.prompt, videoUrl: sourceUrl,
      retake: { start: 18, end: 21, cameraChange:true, middleFrame:{imageUrl:'https://example.com/air.jpg',time:2.5} }, videoModel: 'fal-h3-max' }), expect.objectContaining({ toolName: 'retake_video' }))
  })
  it('allows an inspected camera edit directly without requiring an additional image', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret')
    const result = await (createInspectedRetakeVideoTool(scope).execute as any)({...input,inspection_id:receipt(),source_observation:observation})
    expect(result).toMatchObject({message:'test submission recorded'})
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({script:input.prompt,retake:{start:18,end:21,cameraChange:true}}),expect.anything())
  })
  it('does not name an omitted source video when H3 changes camera coverage',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,prompt:'Continue the advancing action in <<<media_1>>> from a new view.',shot_plan:[{start:1,end:4,instruction:'Continue action from a new view'}],inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({script:'Continue the advancing action in the inspected original scene from a new view.'}),expect.anything());
  });
  it('allows multiple fixed-camera content phases without generating a camera keyframe',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,camera_change:false,
      prompt:'1–2s: transition with a fixed camera. 2–3s: reveal the homepage. 3–4s: hold it.',
      shot_plan:[{start:1,end:2,instruction:'transition'},{start:2,end:3,instruction:'homepage reveal'},{start:3,end:4,instruction:'hold homepage'}],
      inspection_id:receipt(),source_observation:observation});
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({retake:{start:18,end:21}}),expect.anything());
  })
  it('binds the existing user-selected final image directly as Image 2 without a middle frame or duplicate reference',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,camera_change:false,
      prompt:'Finish on <<<media_2>>> after transitioning from <<<media_1>>>.',
      shot_plan:[{start:1,end:4,instruction:'Transition into the supplied final image'}],
      inspection_id:receipt(),source_observation:observation,end_frame_media_index:2,reference_media_indices:[2]});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({images:[],script:'Finish on Image 2 after transitioning from the inspected original scene.',
      retake:{start:18,end:21,endFrame:{imageUrl:'https://example.com/air.jpg'}}}),expect.anything());
  })
  it('binds the selected timeline keyframe to provider-local Image 3 without changing creative text', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret')
    await (createInspectedRetakeVideoTool(scope).execute as any)({...input,
      prompt: input.prompt+' Match <<<media_2>>> at the new camera beat.',
      inspection_id:receipt(),source_observation:observation,middle_frame_media_index:2,middle_frame_time:2.5})
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({script:input.prompt+' Match Image 3 at the new camera beat.'}),expect.anything())
  })
  it.each([{middle_frame_media_index:99,middle_frame_time:2.5},{middle_frame_media_index:2,middle_frame_time:5},{middle_frame_media_index:2}])('rejects missing images and invalid middle times before billing %j',async middle=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret')
    const result=await (createInspectedRetakeVideoTool(scope).execute as any)({...input,inspection_id:receipt(),source_observation:observation,...middle})
    expect(result.success).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
  it.each([
    { prompt: 'Turn, then speak. Output 1–4s.' },
    { shot_plan: [{ start: 0, end: 3, instruction: 'three new cameras' }] },
    { prompt: 'Output-local 0.0–1.0s: close-up. At 1.0s, HARD CUT to medium shot.' },
    { prompt: '1–2s: close-up. At 0.5s, HARD CUT to medium shot.' },
    { prompt: '输出0–1秒：轮子近景；输出1秒处硬切到侧拍。' },
    { prompt: '输出1–2秒：轮子近景；在0.5秒处硬切到侧拍。' },
    { shot_plan: [{ start: 1, end: 2, instruction: 'close-up' }, { start: 3, end: 4, instruction: 'overhead' }] },
    { shot_plan: undefined },
  ])('rejects malformed shot clocks before billing/provider submission %j', async change => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-secret')
    const result = await (createInspectedRetakeVideoTool(scope).execute as any)({ ...input, ...change, inspection_id: receipt(), source_observation: observation })
    expect(result).toMatchObject({ success: false, errorCode: 'retake_prompt_timing_invalid' })
    expect(submit).not.toHaveBeenCalled()
  })
})

it.each(['fal-h3-max','seedance-2.5','seedance-2.5-eco'])('passes creative image references separately from the source video for %s', async model => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
  const signed = signRetakeInspection({userId:'owner',projectId:'project',runId:'run',inputEpoch:0,sourceUrl,start:18,end:21,model},'test-server-secret',{outputSelection:{start:1,end:4},generationDuration:5});
  await (createInspectedRetakeVideoTool(scope).execute as any)({...input,model,camera_change:false,
    prompt:'Use <<<media_2>>> as the brand image within <<<media_1>>>.',
    shot_plan:[{start:1,end:4,instruction:'Integrate the brand image into the ending'}],
    inspection_id:signed,source_observation:observation,reference_media_indices:[2]});
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({images:['https://example.com/air.jpg'],videoUrl:sourceUrl,
    script:model==='fal-h3-max' ? 'Use Image 3 as the brand image within Video 1.' : 'Use <<<image_1>>> as the brand image within @video1.'}),expect.anything());
});
it('rejects a named image without a supplied reference before billing',async()=>{
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-server-secret');
  const result=await (createInspectedRetakeVideoTool(scope).execute as any)({...input,camera_change:false,prompt:'Use <<<media_2>>> as the brand image.',shot_plan:[{start:1,end:4,instruction:'Integrate logo'}],inspection_id:receipt(),source_observation:observation});
  expect(result.success).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
