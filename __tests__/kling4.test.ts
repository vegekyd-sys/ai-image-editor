import { getKlingTask, getKlingMotionControlTask, createKlingTask, createKlingMotionControlTask } from '../src/lib/kling'
import { getVideoModels } from '../src/lib/model-registry'
import { listVideoModelCapabilities } from '../src/lib/video-model-capabilities'
import { validateVideoScript } from '../src/lib/video-harness'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildKling4Payload, createKling4Task } from '../src/lib/kling4'
import { normalizeVideoModelId, resolveVideoProviderModel, validateVideoModelRequest, estimateVideoProviderCostUsd } from '../src/lib/video-model-capabilities'
import { createVideo } from '../src/lib/skills/create-video'
import { bindRetakeReferences } from '../src/lib/video-retake-references'
import { planRetake } from '../src/lib/video-retake-contract'
import { calculateMediaQuote, type MediaPrice } from '../src/lib/billing/media-pricing'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Kling 4.0 candidate contract', () => {
  it('keeps single images as feature references and maps exact provider routes', () => {
    expect(buildKling4Payload({ prompt: 'Use <<<media_1>>>', images: ['https://example.org/mascot.png'] })).toEqual({model:'kling-v4-reference-to-video',prompt:'Use <<<image_1>>>',image_urls:['https://example.org/mascot.png'],duration:5,quality:'720p',aspect_ratio:'16:9'})
    expect(resolveVideoProviderModel({ model:'kling-4',imageReferenceCount:0 })).toBe('kling-v4-text-to-video')
    const edit=buildKling4Payload({prompt:'Edit <<<video_1>>>',images:[],videos:['https://example.org/source.mp4'],operation:'edit'})
    expect(edit).toEqual({model:'kling-v4-video-edit',prompt:'Edit <<<video_1>>>',video_urls:['https://example.org/source.mp4'],duration:'auto',quality:'720p'})
  })
  it('does not invent Flash endpoints, pricing or fallbacks', () => {
    expect(normalizeVideoModelId('Kling 4.0 Flash')).toBe('kling-4-flash')
    expect(validateVideoModelRequest({model:'kling-4-flash'})).toMatch(/no verified callable API/)
    expect(estimateVideoProviderCostUsd({model:'kling-4-flash',durationSec:5})).toBeUndefined()
  })
  it('rejects unsupported inputs before calling a provider', () => {
    expect(()=>buildKling4Payload({prompt:'hello',images:[],duration:2})).toThrow(/3 to 30/)
    expect(()=>buildKling4Payload({prompt:'<<<image_2>>>',images:['https://example.org/1.png']})).toThrow(/missing/)
    expect(validateVideoModelRequest({model:'kling-4',resolution:'4k'})).toMatch(/resolution/i)
    expect(validateVideoModelRequest({model:'kling-4',operation:'extend'})).toMatch(/extension/)
    expect(validateVideoModelRequest({model:'kling-4',audioReferenceCount:1})).toMatch(/at most 0/)
  })
  it('never repeats ambiguous paid submission or exposes upstream bodies',async()=>{
    process.env.EVOLINK_API_KEY='test'
    const fetch=vi.fn().mockResolvedValue(new Response('private-url',{status:500}));vi.stubGlobal('fetch',fetch)
    await expect(createKling4Task({prompt:'hello',images:[]})).rejects.toThrow(/outcome unknown/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps omitted edit duration adaptive and quotes measured input before the one POST', async () => {
    process.env.EVOLINK_API_KEY='test'
    const reserve=vi.fn(async () => undefined)
    const fetch=vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(init?.body))).toMatchObject({model:'kling-v4-video-edit',duration:'auto'})
      return new Response(JSON.stringify({id:'task-unified-test'}),{status:200})
    })
    vi.stubGlobal('fetch',fetch)
    const result=await createVideo({script:'Recolor <<<video_1>>>; keep motion.',images:[],videoUrl:'https://example.org/source.mp4',videoModel:'kling-4',videoOperation:'edit',referenceVideoMetas:[{durationSec:3.95,width:1280,height:720,fileSizeBytes:1000}],onBeforeProviderSubmit:reserve})
    expect(result.success).toBe(true)
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({model:'kling-4',durationSec:3.95,referenceVideoDurationSec:3.95,operation:'edit'}))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects Flash and replacement edit audio before reservation or submission', async () => {
    const reserve=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    expect((await createVideo({script:'test',images:[],videoModel:'kling-4-flash',onBeforeProviderSubmit:reserve})).success).toBe(false)
    expect((await createVideo({script:'test',images:[],videoModel:'kling-4',videoOperation:'edit',videoUrl:'https://example.org/source.mp4',keepOriginalSound:false,onBeforeProviderSubmit:reserve})).success).toBe(false)
    expect(reserve).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('uses the video-input tariff for output + max(input, output)',()=>{
    const price={id:'candidate',model_id:'kling-4',output_usd_per_second:.157,video_reference_usd_per_second:.094,input_usd_per_second:0,input_usd_per_image:0,free_image_references:0,markup:2,unfiltered_multiplier:1,is_active:true,updated_at:'candidate'} as MediaPrice
    expect(calculateMediaQuote(price,{durationSec:5,referenceVideoDurationSec:8}).supplierCostUsd).toBeCloseTo(1.222)
    expect(estimateVideoProviderCostUsd({model:'kling-4',durationSec:5,referenceVideoDurationSec:8})).toBeCloseTo(1.222)
    expect(calculateMediaQuote(price,{durationSec:5,imageCount:1}).supplierCostUsd).toBeCloseTo(.785)
    expect(calculateMediaQuote({...price,operation:'edit'},{durationSec:3.95,referenceVideoDurationSec:3.95}).supplierCostUsd).toBeCloseTo(7.95*.094)
    expect(estimateVideoProviderCostUsd({model:'kling-4',operation:'edit',durationSec:3.95,referenceVideoDurationSec:3.95})).toBeCloseTo(7.95*.094)
  })
  it('binds timeline source indices to Kling native video references', () => {
    expect(bindRetakeReferences({prompt:'Edit <<<media_7>>> with <<<media_3>>>',model:'kling-4',sourceIndex:7,referenceIndices:[3]})).toBe('Edit <<<video_1>>> with <<<image_1>>>')
  })
  it('expands Retake context without expanding the replaced interval',()=>{
    const plan=planRetake({start:1,end:3},5.04,'kling-4')
    expect(plan).toMatchObject({start:1,end:3,contextStart:.5,contextEnd:3.5,patchOffset:.5,generationDuration:3})
    expect(()=>planRetake({start:0,end:1},2,'kling-4')).toThrow(/three seconds/)
    expect(planRetake({start:0,end:3.9},3.95,'kling-4')).toMatchObject({contextEnd:3.95,generationDuration:4})
  })
})


describe('Kling O3 retirement and 30-second boundary', () => {
  it.each(['kling', 'kling-o3', 'kling-v3-omni', 'kling-3.0'])('rejects %s before credit reservation, metadata reads or provider calls', async model => {
    const reserve = vi.fn(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const result = await createVideo({script:'Restyle',images:['https://example.org/image.png'],videoUrl:'https://example.org/video.mp4',videoModel:model,onBeforeProviderSubmit:reserve})
    expect(result).toMatchObject({success:false,retryable:false,message:expect.stringContaining('retired')})
    expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects old Motion Control and direct adapter entrypoints', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch)
    expect((await createVideo({script:'Motion',images:[],videoModel:'seedance',motionControl:true})).message).toContain('retired')
    await expect(createKlingTask({prompt:'test',images:[]})).rejects.toThrow('retired')
    await expect(createKlingMotionControlTask({imageUrl:'https://example.org/i.png',videoUrl:'https://example.org/v.mp4'})).rejects.toThrow('retired')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([false,true])('submits a single 30-second 1080p request (image reference: %s)', async reference => {
    vi.stubEnv('EVOLINK_API_KEY','test')
    const reserve=vi.fn(async()=>undefined)
    const fetch=vi.fn(async (_url:unknown,init:RequestInit|undefined)=> {
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(init?.body))).toMatchObject({duration:30,quality:'1080p',model:reference?'kling-v4-reference-to-video':'kling-v4-text-to-video'})
      return new Response(JSON.stringify({id:'task-unified-30s'}),{status:200})
    });vi.stubGlobal('fetch',fetch)
    const script=reference?'Shot 1 (30s): <<<media_1>>> transforms in one continuous take.':'Shot 1 (30s): One continuous magical transformation.'
    expect(validateVideoScript({prompt:script,imageCount:reference?1:0,model:'kling-4',duration:30})).toBeNull()
    const result=await createVideo({script,images:reference?['https://example.org/hero.png']:[],duration:30,videoModel:'kling-4',videoResolution:'1080p',onBeforeProviderSubmit:reserve})
    expect(result.success).toBe(true);expect(fetch).toHaveBeenCalledTimes(1)
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({durationSec:30,model:'kling-4'}))
  })
  it.each([2,30.5,31])('rejects unsupported duration %s without reservation or submission',async duration=>{
    const reserve=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    const result=await createVideo({script:'Continuous take',images:[],duration,videoModel:'kling-4',onBeforeProviderSubmit:reserve})
    expect(result.success).toBe(false);expect(result.message).toContain('3 to 30')
    expect(reserve).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves legacy task polling and completed video URLs', async()=>{
    vi.stubEnv('KLING_ACCESS_KEY','test');vi.stubEnv('KLING_SECRET_KEY','test')
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.example.org/historical.mp4'}]}}}),{status:200}));vi.stubGlobal('fetch',fetch)
    expect(await getKlingTask('old-task')).toMatchObject({status:'completed',videoUrl:'https://cdn.example.org/historical.mp4'})
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({code:0,data:{task_status:'succeed',task_result:{videos:[{url:'https://cdn.example.org/historical-motion.mp4'}]}}}),{status:200}))
    expect(await getKlingMotionControlTask('old-motion')).toMatchObject({status:'completed',videoUrl:'https://cdn.example.org/historical-motion.mp4'})
    expect(fetch.mock.calls.every(([,init])=>!(init as RequestInit).method || (init as RequestInit).method==='GET')).toBe(true)
  })
  it('exposes only current Kling capabilities and removes conflicting active instructions',()=>{
    expect(getVideoModels().map(m=>m.id)).not.toContain('kling')
    expect(listVideoModelCapabilities().map(m=>m.id)).not.toContain('kling')
    for(const file of ['src/lib/prompts/video-workflow.md','src/lib/prompts/video-submission.md','src/lib/agent-tools.ts','src/mcp/server.ts','packages/makaron-cli/skills/makaron/SKILL.md']) {
      const source=readFileSync(file,'utf8')
      expect(source).not.toMatch(/Kling (?:is |accepts |supports )?5-15/)
      expect(source).toMatch(/Kling 4.0[^\n]*3[-–]30/)
    }
  })
})
