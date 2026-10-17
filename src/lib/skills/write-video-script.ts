import { generateText } from 'ai';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTotalDuration } from '../kling';
import animatePrompt from '../prompts/animate.md';
import { createAgentModelRuntime, getAgentProviderOptions, sumOpenRouterProviderCost } from '../agent-model-runtime';
import { getTokenRate } from '../billing/token-rates';
import { deepSeekFlashProviderCost, deepSeekFlashTariffMultiplier } from '../billing/deepseek-flash-rate';
import { PricingUnavailableError } from '../billing/media-pricing';

// Lazy-loaded animate.md from disk (for standalone MCP server / non-webpack environments)
let _diskAnimatePrompt: string | null = null;
function loadAnimatePromptFromDisk(): string {
  if (!_diskAnimatePrompt) {
    const dir = join(process.cwd(), 'src', 'lib', 'prompts');
    _diskAnimatePrompt = readFileSync(join(dir, 'animate.md'), 'utf-8');
  }
  return _diskAnimatePrompt;
}

export interface WriteVideoScriptInput {
  images: string[];          // resolved URLs or base64 data URLs, 1-7
  userRequest?: string;      // optional user style/mood/story direction
  language?: 'en' | 'zh';    // script language, default en
}

export interface WriteVideoScriptResult {
  usage?: { inputTokens: number; outputTokens: number; modelId: string; provider?: string; providerCostUsd?: number };
  success: boolean;
  script?: string;           // Kling format script with <<<media_N>>> references
  title?: string;            // first line of script (2-5 words)
  estimatedDuration?: number; // parsed from Shot durations
  message: string;
}

export async function writeVideoScript(input: WriteVideoScriptInput): Promise<WriteVideoScriptResult> {
  const { images, userRequest, language = 'en' } = input;

  if (images.length === 0 || images.length > 7) {
    return {
      success: false,
      message: 'Must provide 1-7 images. Provided: ' + images.length,
    };
  }

  try {
    // Compress images before sending them to the vision-capable Agent model.
    const compressedImages = await Promise.all(
      images.map(async (img, i) => {
        let buf: Buffer;
        if (img.startsWith('http')) {
          const res = await fetch(img);
          if (!res.ok) throw new Error(`Failed to fetch image ${i + 1}: ${res.statusText}`);
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          const raw = img.replace(/^data:image\/\w+;base64,/, '');
          buf = Buffer.from(raw, 'base64');
        }

        const format = (await sharp(buf).metadata()).format;
        let mediaType = `image/${format}`;
        // Preserve the actual MIME for small PNG/WebP inputs; only converted
        // images are JPEG. The Flash vision request validates this field.
        if (buf.length > 600_000 || !['jpeg', 'png', 'webp', 'gif'].includes(format || '')) {
          buf = await sharp(buf)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer();
          mediaType = 'image/jpeg';
        }

        const base64Data = buf.toString('base64');
        return `data:${mediaType};base64,${base64Data}`;
      })
    );

    // Build user message
    const prompt = animatePrompt || loadAnimatePromptFromDisk();
    let userMessage = `I have ${images.length} image${images.length > 1 ? 's' : ''} to make into a video.`;
    if (userRequest) {
      userMessage += `\n\nUser request: ${userRequest}`;
    }
    if (language === 'zh') {
      userMessage += `\n\nIMPORTANT: Write the shot descriptions in Chinese. Keep "Shot N (Xs):" format unchanged.`;
    }
    userMessage += `\n\nAnalyze these images and write the video script.`;

    console.log(`\n🎬 [write_video_script] ${images.length} images, language=${language}, userRequest=${userRequest?.slice(0, 50) || 'none'}`);
    const t0 = Date.now();

    const runtime = createAgentModelRuntime(undefined, 'mcp:write-video-script');
    const rate = runtime.spec.id === 'deepseek-flash' ? await getTokenRate(runtime.spec.billingModelId) : null;
    if (runtime.spec.id === 'deepseek-flash' && !rate) throw new PricingUnavailableError('DeepSeek Flash pricing is not configured');
    const requestStartedAt = new Date();
    if (rate) deepSeekFlashTariffMultiplier(requestStartedAt);
    const result = await generateText({
      model: runtime.model,
      system: prompt,
      messages: [
        {
          role: 'user',
          content: [
            ...compressedImages.map((img) => ({ type: 'image' as const, image: img })),
            { type: 'text' as const, text: userMessage },
          ],
        },
      ],
      providerOptions: getAgentProviderOptions(runtime),
    });

    const script = result.text.trim();
    if (!script) {
      console.error(`❌ [write_video_script] Agent model returned empty text after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return {
        success: false,
        message: 'Script generation failed: Agent model returned empty result.',
      };
    }

    // Extract title (first line)
    const lines = script.split('\n');
    const title = lines[0].trim();

    // Parse estimated duration
    const estimatedDuration = parseTotalDuration(script);

    console.log(`✅ [write_video_script] done in ${((Date.now() - t0) / 1000).toFixed(1)}s, script ${script.length} chars, title="${title}", duration=${estimatedDuration ?? 'smart'}s`);

    return {
      success: true,
      script,
      title,
      estimatedDuration,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        modelId: runtime.spec.billingModelId,
        provider: runtime.spec.provider,
        providerCostUsd: rate ? deepSeekFlashProviderCost(rate, {
          noCacheInput: result.usage.inputTokenDetails?.noCacheTokens
            ?? Math.max(0, (result.usage.inputTokens ?? 0) - (result.usage.inputTokenDetails?.cacheReadTokens ?? 0) - (result.usage.inputTokenDetails?.cacheWriteTokens ?? 0)),
          cacheRead: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWrite: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
        }, requestStartedAt) : sumOpenRouterProviderCost(runtime, result.steps),
      },
      message: `Video script generated successfully. ${estimatedDuration ? `Estimated duration: ${estimatedDuration}s.` : 'Duration: smart mode.'}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[write_video_script error]', msg);
    return {
      success: false,
      message: `Script generation error: ${msg}`,
    };
  }
}
