// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/enhance.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/creative.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/wild.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/captions.md', () => ({ default: '' }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {}, Type: {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

function response(tips: unknown[]) {
  const raw = '```json\n' + JSON.stringify(tips, null, 2) + '\n```';
  const chunks = raw.match(/.{1,17}|\n/g) ?? [];
  return new Response(chunks.map(content => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n').join('') + 'data: [DONE]\n\n');
}
async function setup(tips: unknown[]) {
  vi.stubEnv('TIPS_PROVIDER', 'openrouter');
  vi.stubEnv('GOOGLE_API_KEY', '');
  const fetch = vi.fn().mockResolvedValueOnce(response(tips));
  vi.stubGlobal('fetch', fetch);
  const { streamTipsByCategory } = await import('@/lib/gemini');
  return { fetch, streamTipsByCategory };
}

describe('Tips complete instructions survive streaming', () => {
  it.each(['creative', 'wild'] as const)('uses the requested %s category without paid repair', async category => {
    const source = [1, 2].map(i => ({ emoji: '🐈', label: `建议${i}`, desc: '场景中的创意变化', editPrompt: `Keep the subject. Add a cat ${i}.` }));
    const { fetch, streamTipsByCategory } = await setup(source);
    const tips = [];
    for await (const tip of streamTipsByCategory('data:image/jpeg;base64,YQ==', category)) if (tip.editPrompt) tips.push(tip);
    expect(tips).toEqual(source.map(tip => ({ ...tip, category })));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('decodes escaped labels so partials do not create duplicate suggestions', async () => {
    const source = [{ emoji: '🖐️', label: '眼镜框"活"了', desc: '让眼镜架变成两只小手。', editPrompt: 'Transform the glasses.', category: 'wild' }];
    const { fetch, streamTipsByCategory } = await setup(source);
    const completed = [];
    for await (const tip of streamTipsByCategory('data:image/jpeg;base64,YQ==', 'wild', undefined, 1)) if (tip.editPrompt) completed.push(tip);
    expect(completed).toEqual(source);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still repairs a genuinely missing editing instruction', async () => {
    const { fetch, streamTipsByCategory } = await setup([{ emoji: '🐈', label: '馆猫', desc: '猫坐在书上。' }]);
    fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Add a cat sitting on the open book.' } }] }));
    const completed = [];
    for await (const tip of streamTipsByCategory('data:image/jpeg;base64,YQ==', 'creative', undefined, 1)) if (tip.editPrompt) completed.push(tip);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ label: '馆猫', category: 'creative', editPrompt: 'Add a cat sitting on the open book.' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
