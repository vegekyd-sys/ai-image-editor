/** Real main-model routing evaluation. Media submissions are disabled unless --generate is supplied. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateText, stepCountIs } from 'ai';
import sharp from 'sharp';
import { createAgentModelRuntime, getAgentProviderOptions } from '../src/lib/agent-model-runtime';
import { buildSystemPrompt } from '../src/lib/agent';
import { createTools, type AgentContext } from '../src/lib/agent-tools';
import { resolveImageModelChain } from '../src/lib/image-model-capabilities';
import { generateImage } from '../src/lib/model-router';
import type { GenerateImageRequest } from '../src/lib/models/types';

async function main() {
  const output = path.resolve('test-results/image-model-capabilities');
  fs.mkdirSync(output, { recursive: true });
  if (!process.argv.includes('--supplier-only')) {
    const runtime = createAgentModelRuntime('gpt-6-luna', 'image-capability-acceptance');
    const system = await buildSystemPrompt();
    const cases = [
      { id: 'ordinary', prompt: '生成一张蓝色陶瓷茶杯的商品宣传图，白色背景，比例 1:1。', expected: 'gpt-image-2.5-flare' },
      { id: 'panorama', prompt: '用参考图里的 V 生成一张超宽横幅，比例 8:1，用作付款二维码卡片顶部的横条。角色与参考图一致，V 在最左侧 1/4，右边 3/4 是浅蓝到白色柔和渐变留白。不要文字、字母、数字、水印或品牌 logo。比例严格 8:1。', expected: 'gemini-2.1', source: true },
      { id: 'nsfw', prompt: '这是一个已确认的 NSFW 路由测试。请用中性提示词 abstract red fabric texture 生成图片，按 NSFW 路由直接生成；无需扩展内容。', expected: 'qwen-spicy' },
    ];
    const outcomes = await Promise.allSettled(cases.map(async scenario => {
      const ctx: AgentContext = { projectId: `acceptance-${scenario.id}`, currentImage: '', generatedImages: [], snapshotImages: scenario.source ? ['https://example.com/source-V.jpg'] : [], explicitMediaIndices: scenario.source ? [1] : [], currentSnapshotIndex: 0 };
      const real = createTools(ctx, runtime, 'zh');
      const calls: Array<{ input: Record<string, unknown>; selected: string }> = [];
      const result = await generateText({
        model: runtime.model, system,
        prompt: `${scenario.source ? '[Media Index]\n<<<media_1>>>: 用户提供的 V 角色参考图（银白长发，冰蓝衣服，橙色龙虾 pin）。\n\n' : ''}${scenario.prompt}`,
        tools: {
          read_file: real.read_file,
          generate_image: { ...real.generate_image, execute: async input => {
            const selected = resolveImageModelChain({ prompt: input.editPrompt, model: input.model, isNsfw: input.isNsfw,
              aspectRatio: input.aspectRatio, imageResolution: input.imageResolution, background: input.background,
              image: input.media_index ? ctx.snapshotImages[input.media_index - 1] : undefined })[0];
            calls.push({ input: input as Record<string, unknown>, selected });
            return { success: true, usedModel: selected, message: 'Acceptance stub: no image supplier was called.' };
          } },
        },
        stopWhen: stepCountIs(4), providerOptions: getAgentProviderOptions(runtime),
        abortSignal: AbortSignal.timeout(120_000),
      });
      assert.equal(calls.length, 1, `${scenario.id}: exactly one generation decision`);
      assert.equal(calls[0].selected, scenario.expected, `${scenario.id}: selected image model`);
      if (scenario.source) assert.equal(calls[0].input.aspectRatio, '8:1');
      if (scenario.id === 'nsfw') assert.equal(calls[0].input.isNsfw, true);
      return { id: scenario.id, ...calls[0], usage: result.usage, finalText: result.text };
    }));
    const decisions = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
    const errors = outcomes.flatMap((outcome, index) => outcome.status === 'rejected' ? [{ id: cases[index].id, error: outcome.reason instanceof Error ? outcome.reason.message : 'Acceptance failed' }] : []);
    fs.writeFileSync(path.join(output, 'agent-decisions.json'), JSON.stringify({ mainModel: runtime.spec.id, provider: runtime.spec.provider, decisions, errors }, null, 2));
    console.log(JSON.stringify({ mainModel: runtime.spec.id, decisions: decisions.map(d => ({ id: d.id, selected: d.selected })) }));
    assert.equal(errors.length, 0, errors.map(error => `${error.id}: ${error.error}`).join('\n'));
  }

  if (process.argv.includes('--generate') || process.argv.includes('--supplier-only')) {
    const request: GenerateImageRequest = {
      prompt: 'A premium panoramic banner: a glossy ice-blue futuristic ceramic teapot occupies only the left quarter, the right three quarters are a smooth very pale blue to white gradient with sparse tiny blue light particles. A coherent full-bleed 8:1 wide canvas. No text, letters, numbers, logo, watermark or borders.',
      aspectRatio: '8:1',
    };
    // One live supplier submission. Do not retry an unknown paid outcome.
    const started = Date.now();
    const result = await generateImage(request);
    assert.equal(result.model, 'gemini-2.1');
    assert.ok(result.image?.startsWith('data:image/'));
    const bytes = Buffer.from(result.image!.split(',')[1], 'base64');
    const metadata = await sharp(bytes).metadata();
    await sharp(bytes).raw().toBuffer();
    fs.writeFileSync(path.join(output, 'panorama.png'), await sharp(bytes).png().toBuffer());
    const receipt = { model: result.model, provider: result.provider, width: metadata.width, height: metadata.height, elapsedMs: Date.now() - started, usage: result.usage };
    fs.writeFileSync(path.join(output, 'supplier-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
    // Native 1K 8:1 is 2928x352, not an exact mathematical ratio. Keep original pixels.
    // https://runware.ai/docs/models/google-nano-banana-2-1/guides/prompting
    assert.equal(metadata.width, 2928);
    assert.equal(metadata.height, 352);
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'Acceptance failed'); process.exit(1); });
