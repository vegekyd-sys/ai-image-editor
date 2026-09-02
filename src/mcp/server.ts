import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { editImage } from '../lib/skills/edit-image';
import { rotateCamera } from '../lib/skills/rotate-camera';
import { writeVideoScript } from '../lib/skills/write-video-script';
import { createVideo } from '../lib/skills/create-video';
import { getVideoStatus } from '../lib/skills/get-video-status';
import { analyzeVideo } from '../lib/skills/analyze-video';
import { createAudio } from '../lib/skills/create-audio';
import { createMusic } from '../lib/skills/create-music';
import { getMusicStatus } from '../lib/skills/get-music-status';

/** Resolve image input to data URL or HTTP URL for AI APIs. */
function resolveImage(input: string): string {
  if (input.startsWith('data:') || input.startsWith('http')) return input;
  // Local file path — only works in stdio mode (not serverless)
  try {
    const filePath = input.startsWith('file://') ? input.slice(7) : input;
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const buf = readFileSync(filePath);
    const lower = filePath.toLowerCase();
    const mimeType = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.avif')
          ? 'image/avif'
          : 'image/jpeg';
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith('File not found')) throw e;
    throw new Error(`Cannot resolve image: ${input.slice(0, 100)}. Use a URL or base64 data URL.`);
  }
}

/** In stdio mode, save result to disk. In serverless mode, return base64 in MCP response. */
function formatResult(image: string, message: string, prefix: string) {
  const mimeType = image.startsWith('data:image/png')
    ? 'image/png' as const
    : image.startsWith('data:image/webp')
      ? 'image/webp' as const
      : 'image/jpeg' as const;
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  // Try to save to disk (stdio mode). If fs is unavailable or cwd is read-only (serverless), return base64.
  try {
    const outDir = join(process.cwd(), 'mcp-output');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const raw = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    const filename = `${prefix}-${Date.now()}.${extension}`;
    const filePath = join(outDir, filename);
    writeFileSync(filePath, Buffer.from(raw, 'base64'));
    return {
      content: [{ type: 'text' as const, text: `${message}\nSaved to: ${filePath}` }],
    };
  } catch {
    // Serverless: return base64 image in MCP content
    const raw = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    return {
      content: [
        { type: 'text' as const, text: message },
        { type: 'image' as const, data: raw, mimeType },
      ],
    };
  }
}

export interface McpServerOptions {
  /** Authenticated Makaron owner for private subscription relay routing. */
  userId?: string;
  /** Called after each tool completes successfully. Used for billing. */
  onToolComplete?: (
    toolName: string,
    model?: string,
    durationMs?: number,
    usage?: { inputTokens: number; outputTokens: number; modelId: string; providerCostUsd?: number },
    meta?: {
      videoDurationSec?: number
      imageCount?: number
      videoModel?: string
      videoResolution?: string
      referenceVideoDurationSec?: number
      videoOperation?: 'generate' | 'edit' | 'extend'
      contentFilter?: boolean
      provider?: string
      seedAudioDurationSec?: number
      seedAudioProviderCredits?: number
      seedAudioGenerationSec?: number
    },
  ) => void | Promise<void>;
  /** Called before each tool executes. Return false to reject (insufficient credits). */
  onToolStart?: (toolName: string, model?: string) => Promise<{ allowed: boolean; message?: string }>;
  /** Called only before a Grok personal-plan request safely falls back to the paid API. */
  onBeforeGrokApiFallback?: (toolName: string, model?: string) => Promise<void>;
}

export function createMakaronMcpServer(options?: McpServerOptions) {
  const server = new McpServer({
    name: 'makaron',
    version: '1.0.0',
  });

  server.tool(
    'makaron_edit_image',
    `Edit or generate an image using AI. Supports skill templates for different editing styles.

## Recommended skill + model combinations

| Use case | skill | model | Notes |
|----------|-------|-------|-------|
| Enhance/beautify/color grade | enhance | (auto) | Best quality with qwen, auto-routed |
| Add creative fun elements | creative | (auto) | Gemini handles .md templates well |
| Exaggerate/surreal transform | wild | (auto) | Gemini handles .md templates well |
| Add text/captions/titles | captions | (auto) | Gemini handles .md templates well |
| Text-to-image | (omit) | (auto) | gemini→qwen auto fallback, handles all styles including anime |
| NSFW/sensitive editing | (omit) | qwen | Gemini will refuse |
| Design/layout/poster/text | (omit) | openai | Best text rendering & design (~50s, premium pricing) |
| Fast lower-cost drafts | (omit) | gemini-lite | Nano Banana 2 Lite for fast 1K image drafts |
| Not sure | (omit) | (auto) | Auto routing with fallback |

When skill is omitted, editPrompt is sent directly. When skill is set, a structured .md template is injected to guide the AI.
Input image can be a local file path (stdio), URL, or base64 data URL. Omit image for text-to-image generation.

IMPORTANT: Image generation takes 15-30 seconds. Long and detailed prompts are fully supported and produce better results.`,
    {
      image: z.string().nullish().describe('Input image: local file path, URL, or base64 data URL. Omit for text-to-image generation.'),
      editPrompt: z.string().describe('English editing instructions describing what to change'),
      skill: z.enum(['enhance', 'creative', 'wild', 'captions']).nullish().describe('Activate a skill template for structured editing'),
      model: z.enum(['gemini', 'gemini-lite', 'qwen', 'pony', 'wai', 'openai']).nullish().describe('NEVER set unless user literally names a model. Use gemini-lite only when the user asks for Nano Banana 2 Lite / Lite. Gemini refused→retry with qwen. For design/poster/text-heavy tasks, try openai. Otherwise ALWAYS omit.'),
      referenceImages: z.array(z.string()).nullish().describe('Additional reference images (up to 3). Put the original photo here when restoring face/color/details from it.'),
      aspectRatio: z.string().nullish().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
      background: z.enum(['auto', 'opaque', 'transparent']).nullish().describe('Output background. Set transparent for transparent/no-background output, background removal, subject cutout/isolation, or a reusable PNG/sticker/overlay/alpha asset. With image input this is GPT Image 2 image-to-image cutout; without image input it is text-to-image. It never returns an opaque fallback.'),
    },
    async (params) => {
      try {
        // Credit check before execution
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_edit_image');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const image = params.image ? resolveImage(params.image) : undefined;
        const wrappedPrompt = `Directly GENERATE the edited image based on this request. Do NOT output text descriptions — output ONLY the image.\n\nRequest: ${params.editPrompt}`;

        const ctx = {
          currentImage: image,
          referenceImages: params.referenceImages?.map(resolveImage),
        };

        const result = await editImage(
          {
            editPrompt: wrappedPrompt,
            skill: params.skill ?? undefined,
            preferredModel: params.model ?? undefined,
            aspectRatio: params.aspectRatio ?? undefined,
            background: params.background ?? undefined,
          },
          ctx,
        );

        if (!result.success || !result.image) {
          return { content: [{ type: 'text' as const, text: result.message }] };
        }
        // Bill after success
        await options?.onToolComplete?.('makaron_edit_image', result.usedModel, Date.now() - t0, result.usage);
        const msg = result.usedModel
          ? `${result.message} (model: ${result.usedModel})`
          : result.message;
        return formatResult(result.image, msg, 'edit');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP edit_image error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_rotate_camera',
    `Rotate the virtual camera around the subject to show a different perspective.

Parameters:
- azimuth: horizontal rotation (0=front, 45=front-right, 90=right, 135=back-right, 180=back, 225=back-left, 270=left, 315=front-left)
- elevation: vertical angle (-30=low angle, 0=eye level, 30=elevated, 60=high angle)
- distance: zoom level (0.6=close-up, 1.0=medium, 1.4=wide shot)

Uses Qwen Image Edit model to regenerate the image from the requested camera angle.`,
    {
      image: z.string().describe('Input image: local file path, URL, or base64 data URL'),
      azimuth: z.number().min(0).max(360).describe('Horizontal rotation degrees'),
      elevation: z.number().min(-30).max(60).describe('Vertical angle degrees'),
      distance: z.number().min(0.6).max(1.4).describe('Zoom distance'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_rotate_camera');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const image = resolveImage(params.image);
        const result = await rotateCamera(
          { azimuth: params.azimuth, elevation: params.elevation, distance: params.distance },
          { currentImage: image },
        );

        if (!result.success || !result.image) {
          return { content: [{ type: 'text' as const, text: result.message }] };
        }
        await options?.onToolComplete?.('makaron_rotate_camera', undefined, Date.now() - t0);
        return formatResult(result.image, result.message, 'rotate');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP rotate_camera error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_write_video_script',
    `Analyze 1-7 images and write a cinematic video script optimized for Kling VIDEO 3.0 Omni.

Returns a shot-by-shot script with <<<media_N>>> references, camera directions, sound cues, and timing.
The script follows Kling prompt format and can be passed directly to makaron_create_video.

Tips:
- Provide 3-7 images for best results (more variety = better story)
- Images are referenced as <<<media_1>>>, <<<media_2>>> etc. in order
- Optional userRequest lets you guide the style/mood/story direction
- Script generation takes ~30-60s (AI analyzes all images)
- Images can be URLs or base64 data URLs`,
    {
      images: z.array(z.string()).min(1).max(7).describe('Images: URLs or base64 data URLs (1-7)'),
      userRequest: z.string().nullish().describe('Optional style/mood/story direction'),
      language: z.enum(['en', 'zh']).nullish().describe('Script language (default: en)'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_write_video_script');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const resolvedImages = params.images.map((img) => resolveImage(img));
        const result = await writeVideoScript({
          images: resolvedImages,
          userRequest: params.userRequest ?? undefined,
          language: params.language ?? 'en',
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_write_video_script', undefined, Date.now() - t0);
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTitle: ${result.title}\n\n${result.script}`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP write_video_script error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_create_video',
    `Submit a video rendering task. Returns a taskId for polling.

IMPORTANT:
- SeeDance, Wan 3.0, Gemini Omni 1.1, and MiniMax H3 support native text-to-video with no images. For image/reference generation, images must be publicly accessible URLs (not base64).
- EvoLink Seedance reference images must be JPEG/PNG/WebP, width and height each 300-6000px, aspect ratio 0.4-2.5, and <=30MB each. Input errors distinguish too_small, too_large, invalid_aspect_ratio, unsupported_format, and unreadable. NON_RETRYABLE means the same URL must not be resubmitted; prepare a new compliant URL or replace the source first.
- When images are provided, script should use <<<media_N>>> format (from makaron_write_video_script output). Text-to-video scripts should not invent media markers.
- Provider-generated video rendering takes 3-5 minutes; Grok is optimized for substantially faster generation; Gemini Omni is usually around 30-70 seconds plus Storage handoff. Use makaron_get_video_status to poll and measure the actual elapsed time.
- Duration: omit for smart mode. Seedance 2.5 supports 4-30s; Wan 3.0 supports 2-30s; SeeDance 2.0 and MiniMax H3 support 4-15s; Kling supports 5-15s; Grok 1.5 supports 1-15s; Gemini Omni supports 3-10s.
- Resolution: omit or use "auto" for the selected model default. wan-3.0 Standard and wan-3.0-prime support 480p/720p/1080p; wan-3.0-pro supports 1080p/2k/4k super-resolution; Gemini Omni 1.1 supports 360p drafts, 720p native/default, and upscaled 1080p/4k; Seedance 2.5 supports 480p/720p; minimax-h3 supports 768p/2k and defaults to 768p; Grok Imagine Video 1.5 supports text-to-video at 480p/720p/1080p but caps every image/voice reference request at 720p; seedance-fast/seedance-mini support 480p/720p; seedance supports 480p/720p/1080p; kling supports 720p/1080p/4k.
- Seedance 2.5 accepts up to 30 image, 10 video, and 10 audio references, plus dedicated edit/extend modes. Gemini Omni accepts one timeline/external video and can extend it forward for 3-10 seconds (10 seconds by default).

Models:
- seedance-fast (default) — SeeDance 2.0 Fast via Evolink, 480p/720p, default 720p
- seedance-mini — SeeDance 2.0 Mini via Evolink, lower-cost 480p/720p route for drafts and multi-size tests
- seedance — SeeDance 2.0 standard via Evolink, supports 480p/720p/1080p
- seedance-2.5 — Seedance 2.5 via Evolink, 4-30s, multimodal references, native audio, edit and extend
- wan-3.0 — Wan 3.0 Standard via MuleRouter, 2-30s, 480p/720p/1080p, native audio, up to 10 image + 5 video + 5 audio feature references; generation only
- wan-3.0-prime — Wan 3.0 Prime fast tier via MuleRouter, 2-30s, 480p/720p/1080p with the same reference limits; generation only
- wan-3.0-pro — Wan 3.0 Pro/super-resolution via MuleRouter, 2-30s, 1080p/2k/4k with the same reference limits; generation only
- kling — Kling v3-omni, supports 720p/1080p/4k
- grok — one Makaron selector with split xAI routing: Grok Imagine Video 1.5 for text generation (up to 1080p) or feature/reference generation (1-7 images or preset voices, up to 720p, native audio), and Grok Imagine Video for one-video edit/extend (up to 720p)
- google-omni — Gemini Omni 1.1 Flash via Google, fast text/image/video generation, editing, and forward extension, 360p/720p/upscaled 1080p/4k, up to 6 image references without a video reference, one video reference for edit/extend, native generated audio, no uploaded audio references
- minimax-h3 — MiniMax H3 direct API, native text-to-video plus up to 9 image / 3 video / 3 audio references, 4-15s, public 768p/2K, default 768P
- sync-lipsync-v3 — exact replacement-audio lip sync; requires exactly one source video and one audio URL, preserves source framing and the supplied audio

Example script format:
Shot 1 (2s): Wide shot, <<<media_1>>> ...
Shot 2 (3s): Close-up, <<<media_2>>> ...
Style: Cinematic, warm golden light.`,
    {
      script: z.string().describe('Video script with <<<media_N>>> references'),
      images: z.array(z.string().url()).max(30).default([]).describe('Optional public image URLs. Seedance 2.5 accepts up to 30; older routes may accept fewer.'),
      videoUrls: z.array(z.string().url()).max(10).optional().describe('Public reference video URLs. Sync Lipsync v3 requires exactly one; Seedance 2.5 accepts up to 10 with 30 seconds combined.'),
      audioUrls: z.array(z.string().url()).max(10).optional().describe('Public reference audio URLs. Sync Lipsync v3 requires exactly one replacement track; Seedance 2.5 accepts up to 10.'),
      referenceVoiceIds: z.array(z.string()).max(3).optional().describe('Grok Imagine Video 1.5 preset voice ids (up to 3), such as eve or leo. These are provider voice names, not uploaded audio URLs.'),
      referenceVideoDuration: z.number().positive().optional().describe('Known source-video duration in seconds. Pass this for Grok edit/extend so duration validation and input-video billing match the actual source.'),
      duration: z.number().optional().describe('Duration in seconds. Sync Lipsync v3 follows a 2-120s source; Seedance 2.5 accepts 4-30s; Wan 3.0 accepts 2-30s; SeeDance 2.0 and MiniMax H3 accept 4-15s. Omit for smart mode.'),
      aspectRatio: z.enum(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']).optional().describe('Aspect ratio. Use auto/adaptive or a provider-supported ratio. Seedance supports 21:9. Grok reference-to-video supports fixed provider ratios.'),
      videoModel: z.enum(['seedance-fast', 'seedance-mini', 'seedance', 'seedance-2.5', 'wan-3.0', 'wan-3.0-prime', 'wan-3.0-pro', 'kling', 'grok', 'google-omni', 'minimax-h3', 'sync-lipsync-v3']).optional().describe('Video model. Use wan-3.0 for Standard, wan-3.0-prime for Prime/Fast/lower latency, or wan-3.0-pro for Pro/super-resolution/2K/4K; all three support generation with feature references, not typed edit/extend. sync-lipsync-v3 requires exactly one video and one replacement audio track.'),
      videoResolution: z.enum(['auto', '360p', '480p', '720p', '768p', '1080p', '2k', '4k']).optional().describe('Output resolution. Use auto to follow the selected model default; Grok Imagine Video 1.5 supports text-to-video at 480p/720p/1080p and caps every image/voice reference request at 720p; Gemini Omni 1.1 supports 360p/720p/1080p/4k; MiniMax H3 supports 768p/2k.'),
      operation: z.enum(['generate', 'edit', 'extend']).optional().describe('Typed operation. Grok, Gemini Omni, and Seedance 2.5 support edit/extend; both require videoUrls. Grok and Omni extend forward only.'),
      extendDirection: z.enum(['forward', 'backward']).optional().describe('Seedance 2.5 extension direction. Omit or use forward for Gemini Omni.'),
      generateAudio: z.boolean().optional().describe('Generate synchronized native audio. Default true for Seedance 2.5.'),
      contentFilter: z.boolean().optional().describe('Seedance 2.5 output content filter. Default true. False enables Mature Mode and costs 10% more; use only after explicit user confirmation, including the recovery action.'),
      outputFormat: z.enum(['mp4', 'mov']).optional().describe('MP4/H264 for playback or MOV for grading.'),
      webSearch: z.boolean().optional().describe('Enable Seedance 2.5 text-to-video web search grounding.'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_create_video', params.videoModel);
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createVideo({
          script: params.script,
          images: params.images,
          videoUrls: params.videoUrls,
          audioUrls: params.audioUrls,
          referenceVoiceIds: params.referenceVoiceIds,
          referenceVideoDuration: params.referenceVideoDuration,
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          videoModel: params.videoModel,
          videoResolution: params.videoResolution,
          videoOperation: params.operation,
          videoExtendDirection: params.extendDirection,
          generateAudio: params.generateAudio,
          contentFilter: params.contentFilter,
          outputFormat: params.outputFormat,
          webSearch: params.webSearch,
          userId: options?.userId,
          onBeforeGrokApiFallback: options?.onBeforeGrokApiFallback
            ? () => options.onBeforeGrokApiFallback!('makaron_create_video', params.videoModel)
            : undefined,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_create_video', params.videoModel, Date.now() - t0, undefined, {
            videoDurationSec: params.videoModel === 'grok' && params.operation === 'edit'
              ? (params.referenceVideoDuration ?? params.duration ?? 10)
              : (params.duration ?? 10),
            imageCount: params.images.length,
            videoModel: params.videoModel,
            videoResolution: params.videoResolution,
            videoOperation: params.operation,
            referenceVideoDurationSec: params.referenceVideoDuration,
            contentFilter: params.contentFilter,
            provider: result.provider,
          });
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTask ID: ${result.taskId}${result.videoUrl ? `\n\nProvider Video URL: ${result.videoUrl}` : ''}`
          : result.retryable === false
            ? `[NON_RETRYABLE:${result.errorCode || 'invalid_input'}] ${result.message}`
            : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP create_video error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_edit_video',
    `Edit an existing video using AI video-to-video/reference-video generation. Returns a taskId for polling.

Kling supports base/direct video editing. SeeDance supports video-reference editing for short clips.

IMPORTANT:
- videoUrl must be a publicly accessible URL (MP4/MOV/WebM, target ≤15s with tiny metadata padding accepted, ≤200MB, ≤1080p / 2,086,876 pixels)
- SeeDance video editing requires target ≤15s and ≤1080p input video, matching the normal frontend upload flow.
- When referType is "base": the video is the starting point for editing. Images serve as additional references only (no first_frame).
- When referType is "feature": the video provides style/motion reference. Images define the actual content.
- For videoModel "seedance-fast", "seedance-mini", or "seedance", use referType "feature" (default for SeeDance). Base/direct edit is Kling-only.
- images (if any) must be publicly accessible URLs
- Provider-generated video rendering takes 3-5 minutes; Grok is optimized for substantially faster generation; Gemini Omni is usually around 30-70 seconds plus Storage handoff. Use makaron_get_video_status to poll and measure actual elapsed time.

Example: Edit a video to add cinematic color grading:
  videoUrl: "https://...", editPrompt: "Apply warm cinematic color grading with film grain", videoModel: "seedance-fast"`,
    {
      videoUrl: z.string().url().describe('Video URL to edit (MP4/MOV/WebM, target ≤15s with tiny metadata padding accepted, ≤1080p, ≤200MB)'),
      editPrompt: z.string().describe('Editing instructions describing what to change'),
      images: z.array(z.string().url()).max(7).optional().describe('Optional reference images (public URLs)'),
      duration: z.number().optional().describe('Output duration in seconds. SeeDance accepts integer output duration 4-15s (default 5s); Kling supports 5-15s; Grok edit retains a source up to 8.7s and Grok extend adds 2-10s to a 2-15s source; Gemini Omni supports 3-10s video editing in Makaron. Omit for smart mode.'),
      aspectRatio: z.enum(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']).optional().describe('Aspect ratio. Use auto/adaptive or a provider-supported ratio.'),
      videoModel: z.enum(['seedance-fast', 'seedance-mini', 'seedance', 'seedance-2.5', 'kling', 'grok', 'google-omni', 'minimax-h3']).optional().describe('Video model. Seedance 2.5, Grok, and Google Omni use dedicated typed edit routes; MiniMax H3 supports feature/reference video.'),
      videoResolution: z.enum(['auto', '360p', '480p', '720p', '768p', '1080p', '2k', '4k']).optional().describe('Output resolution. Grok edit retains the source shape up to 720p. Use auto to follow the selected model default; Gemini Omni 1.1 supports 360p/720p/1080p/4k, and MiniMax H3 supports 768p/2k.'),
      referType: z.enum(['base', 'feature']).optional().describe('Video role: "base" (edit this video, default) or "feature" (use as style/motion reference)'),
      keepOriginalSound: z.boolean().optional().describe('Keep original video sound (default: false)'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_edit_video', params.videoModel);
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const resolvedModel = params.videoModel ?? 'seedance-fast';
        const resolvedReferType = params.referType ?? (resolvedModel === 'seedance' || resolvedModel === 'seedance-fast' || resolvedModel === 'seedance-mini' || resolvedModel === 'minimax-h3' ? 'feature' : 'base');
        const result = await createVideo({
          script: params.editPrompt,
          images: params.images ?? [],
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          videoModel: resolvedModel,
          videoResolution: params.videoResolution,
          videoUrl: params.videoUrl,
          videoReferType: resolvedReferType,
          keepOriginalSound: params.keepOriginalSound ?? false,
          videoOperation: resolvedModel === 'seedance-2.5' || resolvedModel === 'grok' || resolvedModel === 'google-omni' ? 'edit' : 'generate',
          userId: options?.userId,
          onBeforeGrokApiFallback: options?.onBeforeGrokApiFallback
            ? () => options.onBeforeGrokApiFallback!('makaron_edit_video', params.videoModel)
            : undefined,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_edit_video', resolvedModel, Date.now() - t0, undefined, {
            videoDurationSec: params.duration ?? 10,
            imageCount: params.images?.length ?? 0,
            videoModel: resolvedModel,
            videoResolution: params.videoResolution,
            referenceVideoDurationSec: resolvedModel === 'minimax-h3' ? (params.duration ?? 10) : undefined,
            videoOperation: resolvedModel === 'seedance-2.5' || resolvedModel === 'grok' || resolvedModel === 'google-omni' ? 'edit' : 'generate',
            provider: result.provider,
          });
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTask ID: ${result.taskId}${result.videoUrl ? `\n\nProvider Video URL: ${result.videoUrl}` : ''}`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP edit_video error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_analyze_video',
    `Analyze a video and return scene/action/pacing/audio observations.

Use this as the standalone equivalent of the Agent's analyze_video tool.

IMPORTANT:
- videoUrl must be publicly accessible and downloadable.
- For best compatibility with later SeeDance editing, use the normal Makaron upload constraints: MP4/MOV/WebM, target ≤15s with tiny metadata padding accepted, ≤200MB, ≤1080p / 2,086,876 pixels.
- This tool only analyzes; it does not create or update a project timeline.`,
    {
      videoUrl: z.string().url().describe('Publicly accessible video URL to analyze'),
      question: z.string().optional().describe('Optional focus question, e.g. "describe pacing" or "what happens at 5s?"'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_analyze_video');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await analyzeVideo({
          videoUrl: params.videoUrl,
          question: params.question,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_analyze_video', undefined, Date.now() - t0);
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\n${result.analysis}`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP analyze_video error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_get_video_status',
    `Poll the status of a video rendering task. Returns status + videoUrl when complete.

Status values:
- pending: task queued
- processing: provider rendering in progress (usually 3-5 minutes; Grok generation is optimized for substantially lower latency)
- completed: done, videoUrl available
- failed: error occurred

Poll every 10-15 seconds. Do NOT poll in a tight loop.`,
    {
      taskId: z.string().describe('Task ID from makaron_create_video'),
    },
    async (params) => {
      try {
        const result = await getVideoStatus({ taskId: params.taskId, userId: options?.userId });

        let response = result.message;
        if (result.status === 'completed' && result.videoUrl) {
          response += `\n\nVideo URL: ${result.videoUrl}`;
        }
        if (result.status === 'failed' && result.error && !response.includes(result.error)) {
          response += `\n\nError: ${result.error}`;
        }

        return { content: [{ type: 'text' as const, text: response }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP get_video_status error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  // ── Unified audio generation ─────────────────────────────────────────────

  server.tool(
    'makaron_create_audio',
    `Generate one complete standalone soundtrack with Seed Audio 1.0.

Use a compact playback-order timeline for narration, dialogue, multilingual speech, music, ambience, and sound effects. Use kind=translation with exactly one MP3/WAV audio reference and target_language to translate speech while retaining the speaker's voice and performance. The current gateway accepts prompts up to 1,500 characters and outputs up to 120 seconds. You may provide up to 3 audio references or 1 image reference, but never both. Bind ordinary audio references in prompt order as @audio1, @audio2, and @audio3. WAV/48 kHz is the production-master default.`,
    {
      kind: z.enum(['voiceover', 'dialogue', 'music', 'sound_design', 'mixed', 'translation']).optional(),
      prompt: z.string().max(1250).optional().describe('Complete timeline-directed Seed Audio production brief. Optional only for kind=translation.'),
      target_language: z.string().optional().describe('Required for kind=translation.'),
      translated_script: z.string().optional().describe('Optional exact target-language script. Omit to translate all speech in audio_references[0] directly.'),
      duration_seconds: z.number().positive().max(120).optional().describe('Target duration in seconds.'),
      audio_references: z.array(z.string()).max(3).optional().describe('Public HTTPS audio URLs or provider preset voice IDs, bound as @audio1..@audio3 in the prompt.'),
      image_urls: z.array(z.string().url()).max(1).optional().describe('At most one public HTTPS image URL; mutually exclusive with audio_references.'),
      speech_rate: z.number().min(0.5).max(2).optional(),
      loudness_rate: z.number().min(0.5).max(2).optional(),
      pitch_rate: z.number().int().min(-12).max(12).optional(),
      format: z.enum(['wav', 'mp3', 'ogg_opus', 'pcm']).optional(),
      sample_rate: z.union([z.literal(8000), z.literal(16000), z.literal(24000), z.literal(48000)]).optional(),
      callback_url: z.string().url().optional().describe('Optional HTTPS callback URL.'),
      title: z.string().optional(),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_create_seed_audio');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createAudio({
          prompt: params.prompt,
          kind: params.kind,
          targetLanguage: params.target_language,
          translatedScript: params.translated_script,
          durationSeconds: params.duration_seconds,
          audioReferences: params.audio_references,
          imageUrls: params.image_urls,
          speechRate: params.speech_rate,
          loudnessRate: params.loudness_rate,
          pitchRate: params.pitch_rate,
          format: params.format,
          sampleRate: params.sample_rate,
          callbackUrl: params.callback_url,
          title: params.title,
        });
        if (result.success) {
          await options?.onToolComplete?.('makaron_create_seed_audio', result.model, Date.now() - t0, undefined, {
            seedAudioDurationSec: result.duration,
            seedAudioProviderCredits: result.creditsUsed,
            seedAudioGenerationSec: result.generationSeconds,
          });
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nAudio URL: ${result.audioUrl || 'not returned'}\nTask ID: ${result.taskId || 'n/a'}\nFormat: ${result.format || 'n/a'} / ${result.sampleRate || 'n/a'} Hz`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP create_audio error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  // ── Music generation (compatibility alias) ───────────────────────────────

  server.tool(
    'makaron_create_music',
    `Compatibility alias for music-only Seed Audio requests. Returns a completed audio URL when generation succeeds.

- Music generation waits for the provider result and returns one persisted audio asset when project persistence is available.
- Default: instrumental background music, no vocals.
- Prompt: describe genre, mood, instruments (e.g. "gentle piano, cinematic, warm strings").
- Style: optional genre/mood tags for custom mode (e.g. "lo-fi, ambient, chill").
- New music generation no longer uses Suno.`,
    {
      prompt: z.string().max(1500).describe('Timeline-directed music description: genre, mood, energy arc, instruments, mix role, and ending.'),
      instrumental: z.boolean().optional().describe('Instrumental only, no vocals (default: true)'),
      style: z.string().optional().describe('Genre/mood tags for custom mode (e.g. "lo-fi, ambient")'),
      duration_seconds: z.number().positive().max(120).optional(),
      loudness_rate: z.number().min(0.5).max(2).optional(),
      pitch_rate: z.number().int().min(-12).max(12).optional(),
      format: z.enum(['wav', 'mp3', 'ogg_opus', 'pcm']).optional(),
      sample_rate: z.union([z.literal(8000), z.literal(16000), z.literal(24000), z.literal(48000)]).optional(),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_create_seed_audio');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createMusic({
          prompt: params.prompt,
          instrumental: params.instrumental,
          style: params.style,
          durationSeconds: params.duration_seconds,
          loudnessRate: params.loudness_rate,
          pitchRate: params.pitch_rate,
          format: params.format,
          sampleRate: params.sample_rate,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_create_seed_audio', result.model, Date.now() - t0, undefined, {
            seedAudioDurationSec: result.duration,
            seedAudioProviderCredits: result.creditsUsed,
            seedAudioGenerationSec: result.generationSeconds,
          });
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nAudio URL: ${result.audioUrl || 'not returned'}\nTask ID: ${result.taskId || 'n/a'}`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP create_music error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_get_music_status',
    `Poll the status of a music generation task. Returns status + audioUrl when complete.

Status values:
- pending: task queued
- processing: generating (typically 2-3 minutes)
- completed: done, audioUrl available
- failed: error occurred

Poll every 10-15 seconds. Do NOT poll in a tight loop.`,
    {
      taskId: z.string().describe('Task ID from makaron_create_music'),
    },
    async (params) => {
      try {
        const result = await getMusicStatus({ taskId: params.taskId });

        let response = result.message;
        if (result.status === 'completed' && result.tracks.length) {
          const t = result.tracks[0];
          response += `\n\nAudio URL: ${t.audioUrl}`;
          if (t.duration) response += `\nDuration: ${Math.round(t.duration)}s`;
          if (t.title) response += `\nTitle: ${t.title}`;
          if (result.tracks.length > 1) {
            response += `\n\nTrack 2: ${result.tracks[1].audioUrl} (${Math.round(result.tracks[1].duration)}s)`;
          }
        }
        if (result.status === 'failed' && result.error) {
          response += `\n\nError: ${result.error}`;
        }

        return { content: [{ type: 'text' as const, text: response }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP get_music_status error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  return server;
}
