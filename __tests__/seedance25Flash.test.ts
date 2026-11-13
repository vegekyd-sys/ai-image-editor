import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSeedance25FlashPayload as build } from '@/lib/seedance25-flash'
import { calculateMediaQuote, type MediaPrice } from '@/lib/billing/media-pricing'
import { getDefaultVideoModelId, normalizeVideoResolution, resolveProductVideoModelId, resolveVideoProviderModel, estimateVideoProviderCostUsd, validateVideoModelRequest } from '@/lib/video-model-capabilities'
const model = 'seedance-2.5-flash'
const url = 'https://example.com/media.mp4'
const base = {model: `${model}-text-to-video`, prompt: 'Purple ghost dances', images: []}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })
describe('Flash distinct provider contract', () => {
  it('does not substitute Eco or change defaults', () => {
    expect(resolveProductVideoModelId(model)).toBe(model)
    expect(getDefaultVideoModelId()).toBe('kling-4-flash')
    expect(normalizeVideoResolution(model)).toBe('720p')
    expect(resolveVideoProviderModel({model})).toBe(`${model}-text-to-video`)
    expect(resolveVideoProviderModel({model,imageReferenceCount:1})).toBe(`${model}-reference-to-video`)
    expect(resolveVideoProviderModel({model,imageReferenceCount:2,imageWorkflow:'image-to-video'})).toBe(`${model}-image-to-video`)
    expect(resolveVideoProviderModel({model,operation:'edit'})).toBe(`${model}-video-edit`)
  })
  it.each([-1,3,30.1,31])('rejects duration%s before POST', duration => expect(() => build({...base,duration})).toThrow('integer'))
  it('strips ordinary2.5 options and has explicit defaults', () => {
    expect(build(base)).toEqual({model:base.model,prompt:base.prompt,quality:'720p',duration:5,aspect_ratio:'16:9',generate_audio:true})
  })
  it('edit omits duration/canvas; rejects -1 and extra source', () => {
    const p = build({...base,model:`${model}-video-edit`,videoUrls:[url],generateAudio:false})
    expect(p).not.toHaveProperty('duration'); expect(p).not.toHaveProperty('aspect_ratio')
    expect(p.generate_audio).toBe(false)
    expect(() => build({...base,model:`${model}-video-edit`,videoUrls:[url],duration:-1})).toThrow('omit duration')
    expect(() => build({...base,model:`${model}-video-edit`,videoUrls:[url,url]})).toThrow('exactly one')
  })
  it('first/last frames are explicit and image-only', () => {
    const p=build({...base,model:`${model}-image-to-video`,images:[url,url]})
    expect(p).not.toHaveProperty('aspect_ratio')
    expect(() => build({...base,model:`${model}-image-to-video`,images:[url],audioUrls:[url]})).toThrow('no video/audio')
  })
  it.each([{quality:'1080p'},{webSearch:true},{outputFormat:'mov' as const},{contentFilter:false}])('rejects unsupported option%j', extra => expect(() => build({...base,...extra})).toThrow())
  it('rejects excessive counts, extensions, short source and invalid protocols', () => {
    expect(validateVideoModelRequest({model,operation:'extend'})).toContain('does not support')
    expect(validateVideoModelRequest({model,imageReferenceCount:11})).toContain('at most 10'.replace('most10','most 10'))
    expect(validateVideoModelRequest({model,operation:'edit',videoReferenceCount:1,referenceVideoDuration:3.9})).toContain('4–30')
    expect(() => build({...base,model:`${model}-reference-to-video`,audioUrls:['asset://id']})).toThrow('HTTP(S)')
  })
  it('rounds reference total up and bills edit source twice; static estimate matches persisted tariff', () => {
    const price={id:`video:${model}:720p:generate`,model_id:model,operation:'generate',resolution:'720p',kind:'video',output_usd_per_second:.24,video_reference_usd_per_second:.15,input_usd_per_second:0,input_usd_per_image:0,free_image_references:0,markup:2,unfiltered_multiplier:1,is_active:true,updated_at:'2026-11-13'} as MediaPrice
    const ref={model,durationSec:4,referenceVideoDurationSec:7.1,resolution:'720p' as const}
    expect(() => calculateMediaQuote({...price,video_reference_usd_per_second:null},ref)).toThrow('tariff')
    expect(calculateMediaQuote(price,ref).supplierCostUsd).toBeCloseTo(1.8)
    expect(estimateVideoProviderCostUsd(ref)).toBeCloseTo(1.8)
    expect(calculateMediaQuote({...price,operation:'edit'},{...ref,durationSec:7.1}).supplierCostUsd).toBeCloseTo(2.4)
    expect(estimateVideoProviderCostUsd({...ref,operation:'edit',durationSec:7.1})).toBeCloseTo(2.4)
  })
  it('adapts source edit and markers before reserving and submits once on exact Flash route', async () => {
    vi.stubEnv('EVOLINK_API_KEY','test')
    const posts:Record<string,unknown>[]=[]
    vi.stubGlobal('fetch',vi.fn(async (_u,init) => { posts.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({id:'task-unified-flash-test'})) }))
    const {createVideo}=await import('@/lib/skills/create-video')
    const reserve=vi.fn()
    const result=await createVideo({script:'Edit <<<video_1>>> blue',images:[],videoUrls:[url],videoModel:model,videoOperation:'edit',referenceVideoDuration:4.2,referenceVideoMetas:[{durationSec:4.2,width:854,height:480,fileSizeBytes:50000}],onBeforeProviderSubmit:reserve})
    expect(result).toMatchObject({success:true,videoModel:model,providerModel:`${model}-video-edit`})
    expect(posts).toHaveLength(1);expect(posts[0]).not.toHaveProperty('duration');expect(posts[0]).not.toHaveProperty('aspect_ratio');expect(posts[0].prompt).toContain('@video1')
    expect(reserve.mock.calls[0][0]).toMatchObject({durationSec:4.2,referenceVideoDurationSec:4.2,operation:'edit'})
  })
  it('invalid unsupported inputs never reserve or POST', async () => {
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const reserve=vi.fn()
    const {createVideo}=await import('@/lib/skills/create-video')
    const r=await createVideo({script:'Dance',images:[],videoModel:model,duration:4,webSearch:true,onBeforeProviderSubmit:reserve})
    expect(r.success).toBe(false);expect(reserve).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled()
  })
})
