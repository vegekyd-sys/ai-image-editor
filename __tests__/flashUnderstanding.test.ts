// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokensToCreditsBreakdown } from '@/lib/billing/token-rates';
import { normalizeVideoUsage } from '@/lib/video-analysis';
const mocks = vi.hoisted(() => ({ relay: vi.fn(), api: vi.fn(), video: vi.fn(), deduct: vi.fn(), log: vi.fn() }));
vi.mock('@google/genai', () => ({ ThinkingLevel: { LOW: 'LOW' }, GoogleGenAI: class { models = { generateContent: mocks.api }; } }));
vi.mock('@/lib/gemini-video-subscription', () => ({ tryGeminiUnderstandingSubscription: mocks.relay }));
vi.mock('@/lib/video-analysis', async original => ({ ...await original<object>(), analyzeVideoWithProvider: mocks.video }));
vi.mock('@/lib/billing/credits', () => ({ deductByTokens: mocks.deduct, recordSubscriptionUsage: mocks.log }));
import { generateFlashUnderstanding } from '@/lib/flash-understanding';
const rate = { model_id:'gemini-3.8-flash',display_name:'Flash',input_per_1m:.75,output_per_1m:3.75,cache_read_per_1m:.075,markup:2,is_active:true };
beforeEach(() => {
  vi.resetAllMocks(); mocks.deduct.mockResolvedValue({ charged: 1 }); mocks.log.mockResolvedValue(undefined);
  mocks.api.mockResolvedValue({ text:'A blue square.',modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'STOP'}],
    usageMetadata:{ promptTokenCount:1000,candidatesTokenCount:100,thoughtsTokenCount:50,cachedContentTokenCount:300 } });
});
afterEach(() => vi.clearAllMocks());
describe('Flash helper accounting and routing', () => {
  it('matches the production one-credit receipt and rounds larger usage instead of charging a flat credit', () => {
    expect(tokensToCreditsBreakdown(rate,{noCacheInput:712,output:107,cacheRead:0,cacheWrite:0})).toBe(1);
    expect(tokensToCreditsBreakdown(rate,{noCacheInput:10000,output:1000,cacheRead:0,cacheWrite:0})).toBe(3);
    expect(tokensToCreditsBreakdown(rate,{noCacheInput:0,output:0,cacheRead:0,cacheWrite:0})).toBe(0);
    expect(tokensToCreditsBreakdown(rate,{noCacheInput:0,output:0,cacheRead:10000,cacheWrite:0})).toBe(1);
    expect(normalizeVideoUsage({promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,toolUsePromptTokenCount:10},'x','static'))
      .toMatchObject({inputTokens:110,outputTokens:50,thoughtTokens:30,toolUseTokens:10});
  });
  it.each(['makaron_image_analysis','makaron_frame_verify'] as const)('bills %s once, counting thoughts and splitting cached input', async operation => {
    await generateFlashUnderstanding({operation,images:[],question:'Q',userId:'admin'});
    expect(mocks.api.mock.calls[0][0]).toMatchObject({model:'gemini-3.8-flash',config:{thinkingConfig:{thinkingLevel:'LOW'}}});
    expect(mocks.deduct).toHaveBeenCalledExactlyOnceWith('admin',operation==='makaron_image_analysis'?'analyze_image':'analyze_video',
      'gemini-3.8-flash',700,150,expect.any(Number),undefined,{cacheRead:300,cacheWrite:0});
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('records subscription usage at zero Makaron credits and never calls the API', async () => {
    mocks.relay.mockResolvedValue({provider:'gemini-subscription',usedModel:'gemini-3.8-flash-n',analysis:'Blue',elapsedMs:10,
      usage:{inputTokens:1000,outputTokens:150,cacheReadTokens:300}});
    await generateFlashUnderstanding({operation:'makaron_image_analysis',images:[],question:'Q',userId:'admin'});
    expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith('admin','gemini-subscription','analyze_image','gemini-3.8-flash-n',
      {inputTokens:1000,outputTokens:150,cacheReadTokens:300,durationMs:10});
  });
  it('never bills or submits to the API after an unknown subscription outcome', async () => {
    mocks.relay.mockRejectedValue(new Error('relay_unknown_outcome'));
    await expect(generateFlashUnderstanding({operation:'makaron_frame_locate',images:[],videoUrl:'https://example.test/a.mp4',question:'Q',userId:'admin'})).rejects.toThrow('relay_unknown_outcome');
    expect(mocks.api).not.toHaveBeenCalled();expect(mocks.video).not.toHaveBeenCalled();expect(mocks.deduct).not.toHaveBeenCalled();
  });
});
