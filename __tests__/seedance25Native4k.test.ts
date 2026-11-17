import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVideoModelId, resolveAgentVideoSelection, resolveVideoGenerationRoute, resolveVideoProviderModel, estimateVideoProviderCostUsd } from '@/lib/video-model-capabilities'
import { calculateMediaQuote, quoteVideo, type MediaPrice } from '@/lib/billing/media-pricing'

const pricesQuery=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({getSupabaseAdmin:()=>({from:()=>({select:()=>({order:pricesQuery})})})}))

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })
describe('explicit Seedance 2.5 native 4K candidate', () => {
  it('keeps default/Eco policies and routes explicit native 4K to generation without enhancement', async () => {
    expect(getDefaultVideoModelId()).toBe('kling-4-flash')
    expect(resolveAgentVideoSelection({toolModel:'seedance-2.5',toolResolution:'4k'})).toMatchObject({model:'seedance-2.5-eco'})
    expect(resolveAgentVideoSelection({toolModel:'seedance-2.5-native',toolResolution:'4k'})).toMatchObject({model:'seedance-2.5',resolution:'4k'})
    expect(resolveVideoGenerationRoute({model:'seedance-2.5-native',resolution:'4k'})).toMatchObject({model:'seedance-2.5',resolution:'4k',provider:'seedance'})
    vi.stubEnv('EVOLINK_API_KEY','test')
    const posts:Record<string,unknown>[]=[]
    vi.stubGlobal('fetch',vi.fn(async (_url, init) => { posts.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({id:'task-unified-native4k'})) }))
    const {createVideo}=await import('@/lib/skills/create-video')
    const before=vi.fn()
    const result=await createVideo({script:'An original purple wizard waves',images:[],duration:4,videoModel:'seedance-2.5-native',videoResolution:'4k',aspectRatio:'16:9',onBeforeProviderSubmit:before})
    expect(result).toMatchObject({success:true,providerModel:'seedance-2.5-text-to-video'})
    expect(posts).toEqual([expect.objectContaining({model:'seedance-2.5-text-to-video',quality:'4k',duration:4})])
    expect(before.mock.calls[0][0]).toMatchObject({model:'seedance-2.5',resolution:'4k',durationSec:4})
  })
  it('blocks missing high-resolution pricing before the paid POST', async () => {
    vi.stubEnv('EVOLINK_API_KEY','test')
    pricesQuery.mockResolvedValue({data:[{id:'video:seedance-2.5:480p:generate'}],error:null})
    const post=vi.fn();vi.stubGlobal('fetch',post)
    const {createVideo}=await import('@/lib/skills/create-video')
    const r=await createVideo({script:'wizard',images:[],duration:4,videoModel:'seedance-2.5-native',videoResolution:'4k',onBeforeProviderSubmit:async input=>{await quoteVideo(input)}})
    expect(r.success).toBe(false)
    expect(r.message).toContain('pricing is not configured')
    expect(post).not.toHaveBeenCalled()
  })
  it.each(['generate','edit','extend'] as const)('resolves native 4K %s and uses the video-input rate instead of output-only cost', operation => {
    expect(resolveVideoProviderModel({model:'seedance-2.5-native',resolution:'4k',operation,hasVideoReference:true})).toBe(operation==='generate'?'seedance-2.5-reference-to-video':`seedance-2.5-video-${operation}`)
    const price={id:`video:seedance-2.5:4k:${operation}`,kind:'video',model_id:'seedance-2.5',resolution:'4k',operation,output_usd_per_second:1.182,video_reference_usd_per_second:.724,input_usd_per_second:0,input_usd_per_image:0,free_image_references:0,markup:2,unfiltered_multiplier:1.1,is_active:true,updated_at:'candidate'} as MediaPrice
    const input={model:'seedance-2.5-native',resolution:'4k' as const,operation,durationSec:4,referenceVideoDurationSec:8}
    expect(calculateMediaQuote(price,input).supplierCostUsd).toBeCloseTo(8.688)
    expect(calculateMediaQuote(price,input).credits).toBe(1738)
    expect(estimateVideoProviderCostUsd(input)).toBeCloseTo(8.688)
    expect(() => calculateMediaQuote({...price,video_reference_usd_per_second:null},input)).toThrow('tariff')
  })
})
