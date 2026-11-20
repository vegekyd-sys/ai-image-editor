import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildControlledH3Request, createControlledH3Video } from '@/lib/fal-h3-controlled-video'
import { buildFalH3TurboRequest } from '@/lib/fal-h3-max-video'
import { buildH3MaxReferencePayload } from '@/lib/fal-h3-max-reference-video'
import { videoPriceId } from '@/lib/billing/media-pricing'
import { h3ControlsSchema, type H3Controls } from '@/lib/h3-controls'
import type { CreateVideoInput } from '@/lib/skills/create-video'
import { generateAnimationHarness } from './helpers/generateAnimationHarness'

const image = 'https://example.com/actor.png'
const costume = 'https://example.com/costume.png'
const video = { url: 'https://example.com/motion.mp4', durationSec: 5 }
const audio = { url: 'https://example.com/speech.wav', durationSec: 5 }
const media = { dimensions: [], videos: [], audios: [], referenceImagePixels: 331776, referenceAudioDurationSec: 0, referenceVideoDurationSec: 0 }
const input: CreateVideoInput = { script: 'A continuous shot', images: [image], duration: 5, videoModel: 'fal-h3-max' }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('explicit H3 controls', () => {
  it('binds mixed positions in file order and preserves local typed references independently of prompt order', () => {
    const payload = buildH3MaxReferencePayload({ images: [image, costume], videos: [video], audios: [audio],
      prompt: '<<<media_4>>> on <<<media_1>>>; move like <<<media_2>>> to <<<audio_1>>>',
      referenceOrder: ['image','video','audio','image'] })
    expect(payload.prompt).toBe('Image 2 on Image 1; move like Video 1 to Audio 1')
    expect(payload.reference_conditions).toEqual([
      { type: 'image', url: image }, { type: 'video', url: video.url },
      { type: 'audio', url: audio.url }, { type: 'image', url: costume },
    ])
    expect(payload).not.toHaveProperty('reference_image_urls')
    expect(() => buildH3MaxReferencePayload({images:[image],prompt:'shot',referenceOrder:['audio']})).toThrow()
  })
  it('uses the supplier-confirmed 8728 tokens for the four-file fixture', () => {
    const measured = { ...media, dimensions:[{width:768,height:432},{width:768,height:432}],
      videos:[{...video, durationSec:2, fps:24, frameCount:48, width:768, height:432}], audios:[audio], referenceAudioDurationSec:5 }
    const result = buildControlledH3Request({...input, images:[image,costume],videoResolution:'480p'},
      {kind:'max-reference',order:['image','video','audio','image']},measured)
    expect(result.usage.measuredReferenceTokens).toBe(8728)
  })
  it('keeps grouped requests and ordinary Turbo payloads intact', () => {
    const grouped = buildH3MaxReferencePayload({ images: [image], prompt: '<<<media_1>>>' })
    expect(grouped.reference_image_urls).toEqual([image])
    expect(grouped).not.toHaveProperty('reference_conditions')
    expect(buildFalH3TurboRequest({images:[image],prompt:'<<<media_1>>>'})).toEqual({
      endpoint:'minimax/h3-max-turbo/image-to-video',
      payload:{prompt:'the provided first frame',duration:5,resolution:'768P',image_url:image,
        sync_mode:false,enable_safety_checker:true,prompt_expansion_mode:'balanced'},
    })
  })
  it('locks the soundtrack without charging reference-audio tokens, also for text generation', () => {
    const request = buildControlledH3Request({...input,images:[]},{kind:'max-reference',lockAudio:true},
      {...media,audios:[audio],referenceAudioDurationSec:5})
    expect(request.endpoint).toBe('minimax/h3-max/text-to-video')
    expect(request.payload.target_audio_url).toBe(audio.url)
    expect(request.payload).not.toHaveProperty('reference_audio_urls')
    expect(request.usage.referenceAudioDurationSec).toBe(0)
  })
  it('submits end-only and first/last Turbo frames at explicitly selected 1080p', () => {
    const make = (frames: 'last'|'first-last', images: string[]) => buildControlledH3Request(
      {...input,images,videoModel:'minimax-h3-max', videoResolution:'1080p'}, {kind:'turbo-generation',frames},media)
    const end = make('last',[costume])
    expect(end.payload).toMatchObject({resolution:'1080P',end_image_url:costume})
    expect(end.payload).not.toHaveProperty('image_url')
    expect(make('first-last',[image,costume]).payload).toMatchObject({image_url:image,end_image_url:costume})
    expect(videoPriceId(end.usage)).toBe('video:minimax-h3-max:turbo-generation:1080p')
    expect(() => make('first-last',[image])).toThrow()
  })
  it.each([
    ['turbo-extend','minimax-h3-max',[],[video],[],'minimax/h3-max-turbo/extend-video'],
    ['relight','fal-h3-max',[image],[video],[],'minimax/h3-max/relight'],
    ['reframe','fal-h3-max',[],[video],[],'minimax/h3-max/reframe-video'],
    ['recast','fal-h3-max',[image],[video],[],'minimax/h3-max/recast'],
    ['photo-lipsync','fal-h3-max',[image],[],[audio],'minimax/h3-max/lip-sync/image-to-video'],
  ] as const)('routes explicit %s to its independent endpoint', (kind,videoModel,images,videos,audios,endpoint) => {
    const request=buildControlledH3Request({...input,videoModel,images:[...images],aspectRatio:kind==='reframe'?'1:1':undefined},
      {kind}, {...media,videos:[...videos],audios:[...audios]})
    expect(request.endpoint).toBe(endpoint)
    expect(request.usage.h3Operation).toBe(kind)
    if(kind==='turbo-extend')expect(request.payload.output).toBe('extended')
    if(kind==='relight')expect(request.usage.durationSec).toBe(107/24)
  })
  it('rejects conflicting camera poses, wrong model, wrong modalities and unavailable tariffs before posting', async () => {
    const pose={time:0,azimuth:25,elevation:0,distance:1}
    expect(() => buildControlledH3Request(input,{kind:'camera',trajectory:[pose,pose]},media)).toThrow(/ordered/)
    expect(() => buildControlledH3Request(input,{kind:'turbo-generation'},media)).toThrow(/model/)
    expect(() => buildControlledH3Request(input,{kind:'photo-lipsync'},media)).toThrow(/speech/)
    expect(h3ControlsSchema.safeParse({kind:'camera',trajectory:[pose,{...pose,time:2}]}).success).toBe(false)
    const submit=vi.fn();vi.stubGlobal('fetch',submit);vi.stubEnv('MAKARON_H3_EXPERIMENTS','recast')
    for(const kind of ['turbo-generation','recast'] as const) {
      expect(await createControlledH3Video({...input,h3Controls:{kind}})).toMatchObject({success:false,submissionUncertain:false})
    }
    expect(submit).not.toHaveBeenCalled()
  })
  it('uses explicit Agent selections only, including a non-first timeline image', async () => {
    vi.stubEnv('MAKARON_H3_EXPERIMENTS','max-reference')
    const {tool, createVideo}=generateAnimationHarness()
    const controls: H3Controls={kind:'max-reference',order:['image']}
    await tool.execute({model:'fal-h3-max',story_prompt:'<<<media_1>>> steps forward.',duration:5,h3_media_indices:[2],h3_controls:controls})
    expect(createVideo).toHaveBeenCalledWith(expect.objectContaining({images:['https://example.com/generated.jpg'],h3Controls:controls}))
  })
})
