import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildH3MaxReferencePayload as build, createFalH3MaxReferenceVideoTask as create, estimateH3MaxReferenceCost as quote } from '@/lib/fal-h3-max-reference-video'
import { getFalH3MaxVideoTask } from '@/lib/fal-h3-max-video'
const image = 'https://example.com/person.jpg'
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('H3 Max reference adapter',()=>{
  it('keeps a single image as a reference, with a new output composition',()=>{
    expect(build({prompt:'<<<media_1>>> in a new room',images:[image],aspectRatio:'9:16'})).toMatchObject({prompt:'Image 1 in a new room', reference_image_urls:[image],aspect_ratio:'9:16',resolution:'768P'})
    expect(build({prompt:'<<<image_1>>>',images:[image]})).not.toHaveProperty('image_url')
  })
  it('preserves each modality and index instead of flattening to a first frame',()=>{
    expect(build({prompt:'<<<media_2>>> meets <<<image_1>>>. Follow <<<video_1>>> and <<<audio_1>>>.',images:[image,image],videos:[{url:'v',durationSec:5}],audios:[{url:'https://example.com/a.wav',durationSec:3}]})).toMatchObject({prompt:'Image 2 meets Image 1. Follow Video 1 and Audio 1.',reference_video_urls:['v'],reference_audio_urls:['https://example.com/a.wav']})
  })
  it.each([5,7,10,15])('accepts documented integer output duration %s',duration=>expect(build({prompt:'p',images:[image],duration}).duration).toBe(duration))
  it.each([4,5.5,16])('rejects invalid duration %s',duration=>expect(()=>build({prompt:'p',images:[image],duration})).toThrow())
  it('rejects missing references and out-of-range indices',()=>{
    expect(()=>build({prompt:'p',images:[],audios:[{url:'a',durationSec:3}]})).toThrow('at least one')
    expect(()=>build({prompt:'<<<media_2>>>',images:[image]})).toThrow('no matching')
  })
  it('enforces modality limits, pooled count, and per-modality duration budgets',()=>{
    expect(()=>build({prompt:'p',images:Array(10).fill(image)})).toThrow('9 images')
    expect(()=>build({prompt:'p',images:Array(9).fill(image),videos:Array(3).fill({url:'v',durationSec:2}),audios:[{url:'a',durationSec:2}]})).toThrow('12 total')
    expect(()=>build({prompt:'p',images:[image],videos:[{url:'v',durationSec:1}]})).toThrow('2-15')
    expect(()=>build({prompt:'p',images:[image],audios:Array(2).fill({url:'a',durationSec:8})})).toThrow('total at most 15')
  })
  it('matches official reference-token pricing example and pools the allowance once',()=>{
    const result=quote({duration:5,resolution:'768p',images:Array(2).fill({width:1024,height:1024}),videoSeconds:5,audioSeconds:0})
    expect(result.referenceTokens).toBe(39344)
    expect(result.totalUsd).toBeCloseTo(1.10496)
    expect(result.estimatedCreditsAt2x).toBe(221)
    expect(quote({duration:5,resolution:'768p',images:[{width:2048,height:2048}],videoSeconds:0,audioSeconds:3}).referenceUsd).toBeCloseTo(0.0048)
  })
  it('rejects audio data URIs before they become unsupported .bin files at fal',()=>{
    expect(()=>build({prompt:'p',images:[image],audios:[{url:'data:audio/wav;base64,AA==',durationSec:3}]})).toThrow('HTTPS file URL')
  })
  it('submits exactly once after image preflight and reservation',async()=>{
    const events:string[]=[]
    vi.stubEnv('FAL_KEY','test-key')
    vi.spyOn(await import('@/lib/provider-image-preflight'),'validateProviderImages').mockImplementation(async()=>{events.push('preflight')})
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      events.push('submit');expect(url).toBe('https://queue.fal.run/minimax/h3-max/reference-to-video')
      expect(JSON.parse(init.body).reference_image_urls).toEqual([image])
      return new Response(JSON.stringify({request_id:'abc'}),{status:200})
    }))
    expect(await create({prompt:'<<<media_1>>>',images:[image],onBeforeSubmit:async()=>{events.push('reserve')}})).toBe('fal-h3max-reference-abc')
    expect(events).toEqual(['preflight','reserve','submit'])
  })
  it('reports a confirmed input rejection without a receipt or automatic retry', async () => {
    vi.stubEnv('FAL_KEY', 'test-key')
    const request = vi.fn(async () => new Response('{}', { status: 422 }))
    vi.stubGlobal('fetch', request)
    await expect(create({ prompt: 'test', images: [] })).rejects.toMatchObject({ code: 'INVALID_REFERENCE_MEDIA' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('polls reference tasks on H3 Max, never the Turbo queue',async()=>{
    vi.stubEnv('FAL_KEY','test-key')
    vi.stubGlobal('fetch',vi.fn(async url=>{
      expect(String(url)).toContain('https://queue.fal.run/minimax/h3-max/requests/abc')
      return new Response(JSON.stringify(String(url).endsWith('/status')?{status:'COMPLETED'}:{video:{url:'https://example.com/result.mp4'}}),{status:200})
    }))
    expect(await getFalH3MaxVideoTask('fal-h3max-reference-abc')).toMatchObject({status:'completed',videoUrl:'https://example.com/result.mp4'})
  })
})
