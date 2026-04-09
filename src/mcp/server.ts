import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { editImage } from '../lib/skills/edit-image';
import { rotateCamera } from '../lib/skills/rotate-camera';
import { writeVideoScript } from '../lib/skills/write-video-script';
import { createVideo } from '../lib/skills/create-video';
import { getVideoStatus } from '../lib/skills/get-video-status';
import { createMusic } from '../lib/skills/create-music';
import { getMusicStatus } from '../lib/skills/get-music-status';

/** Resolve image input to data URL or HTTP URL for AI APIs. */
function resolveImage(input: string): string {
  if (input.startsWith('data:') || input.startsWith('http')) return input;
  // Local file path — only works in stdio mode (not serverless)
  try {
    const { readFileSync, existsSync } = require('fs');
    const filePath = input.startsWith('file://') ? input.slice(7) : input;
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const buf = readFileSync(filePath);
    const ext = filePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith('File not found')) throw e;
    throw new Error(`Cannot resolve image: ${input.slice(0, 100)}. Use a URL or base64 data URL.`);
  }
}

/** In stdio mode, save result to disk. In serverless mode, return base64 in MCP response. */
function formatResult(image: string, message: string, prefix: string) {
  // Try to save to disk (stdio mode). If fs is unavailable or cwd is read-only (serverless), return base64.
  try {
    const { writeFileSync, existsSync, mkdirSync } = require('fs');
    const { join } = require('path');
    const outDir = join(process.cwd(), 'mcp-output');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const raw = image.replace(/^data:image\/\w+;base64,/, '');
    const ext = image.includes('image/png') ? 'png' : 'jpg';
    const filename = `${prefix}-${Date.now()}.${ext}`;
    const filePath = join(outDir, filename);
    writeFileSync(filePath, Buffer.from(raw, 'base64'));
    return {
      content: [{ type: 'text' as const, text: `${message}\nSaved to: ${filePath}` }],
    };
  } catch {
    // Serverless: return base64 image in MCP content
    const raw = image.replace(/^data:image\/\w+;base64,/, '');
    return {
      content: [
        { type: 'text' as const, text: message },
        { type: 'image' as const, data: raw, mimeType: 'image/jpeg' as const },
      ],
    };
  }
}

export interface McpServerOptions {
  /** Called after each tool completes successfully. Used for billing. */
  onToolComplete?: (toolName: string, model?: string, durationMs?: number) => void | Promise<void>;
  /** Called before each tool executes. Return false to reject (insufficient credits). */
  onToolStart?: (toolName: string) => Promise<{ allowed: boolean; message?: string }>;
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
| Not sure | (omit) | (auto) | Auto routing with fallback |

When skill is omitted, editPrompt is sent directly. When skill is set, a structured .md template is injected to guide the AI.
Input image can be a local file path (stdio), URL, or base64 data URL. Omit image for text-to-image generation.

IMPORTANT: Image generation takes 15-30 seconds. Long and detailed prompts are fully supported and produce better results.`,
    {
      image: z.string().nullish().describe('Input image: local file path, URL, or base64 data URL. Omit for text-to-image generation.'),
      editPrompt: z.string().describe('English editing instructions describing what to change'),
      skill: z.enum(['enhance', 'creative', 'wild', 'captions']).nullish().describe('Activate a skill template for structured editing'),
      model: z.enum(['gemini', 'qwen', 'pony', 'wai']).nullish().describe('NEVER set unless user literally names a model. Gemini refused→retry with qwen. Otherwise ALWAYS omit.'),
      originalImage: z.string().nullish().describe('Original photo URL/base64 for face restoration reference'),
      referenceImages: z.array(z.string()).nullish().describe('Additional reference images (up to 3)'),
      useOriginalAsReference: z.boolean().nullish().describe('Use originalImage as reference for face/color restoration'),
      aspectRatio: z.string().nullish().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
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
          originalImage: params.originalImage ? resolveImage(params.originalImage) : undefined,
          referenceImages: params.referenceImages?.map(resolveImage),
        };

        const result = await editImage(
          {
            editPrompt: wrappedPrompt,
            skill: params.skill ?? undefined,
            preferredModel: params.model ?? undefined,
            useOriginalAsReference: params.useOriginalAsReference ?? undefined,
            aspectRatio: params.aspectRatio ?? undefined,
          },
          ctx,
        );

        if (!result.success || !result.image) {
          return { content: [{ type: 'text' as const, text: result.message }] };
        }
        // Bill after success
        await options?.onToolComplete?.('makaron_edit_image', result.usedModel, Date.now() - t0);
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

Returns a shot-by-shot script with <<<image_N>>> references, camera directions, sound cues, and timing.
The script follows Kling prompt format and can be passed directly to makaron_create_video.

Tips:
- Provide 3-7 images for best results (more variety = better story)
- Images are referenced as <<<image_1>>>, <<<image_2>>> etc. in order
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
    `Submit a video rendering task to Kling AI. Returns a taskId for polling.

IMPORTANT:
- images must be publicly accessible URLs (not base64). Upload to storage first.
- script should use <<<image_N>>> format (from makaron_write_video_script output)
- Video rendering takes 3-5 minutes. Use makaron_get_video_status to poll.
- Duration: omit for smart mode (AI decides 3-15s based on script).

Example script format:
Shot 1 (2s): Wide shot, <<<image_1>>> ...
Shot 2 (3s): Close-up, <<<image_2>>> ...
Style: Cinematic, warm golden light.`,
    {
      script: z.string().describe('Video script with <<<image_N>>> references'),
      images: z.array(z.string().url()).min(1).max(7).describe('Publicly accessible image URLs'),
      duration: z.number().optional().describe('Duration: 3, 5, 7, 10, or 15 seconds. Omit for smart mode.'),
      aspectRatio: z.string().optional().describe('Aspect ratio: "9:16", "16:9", "1:1"'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_create_video');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createVideo({
          script: params.script,
          images: params.images,
          duration: params.duration,
          aspectRatio: params.aspectRatio,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_create_video', undefined, Date.now() - t0);
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTask ID: ${result.taskId}`
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
    `Edit an existing video using Kling AI video-to-video. Returns a taskId for polling.

Uses the video as a base (default) to apply edits described in the script/prompt,
or as a feature reference to transfer style/motion to new content.

IMPORTANT:
- videoUrl must be a publicly accessible URL (MP4/MOV, ≥3s, 720-2160px, 24-60fps, ≤200MB)
- When referType is "base": the video is the starting point for editing. Images serve as additional references only (no first_frame).
- When referType is "feature": the video provides style/motion reference. Images define the actual content.
- images (if any) must be publicly accessible URLs
- Video rendering takes 3-5 minutes. Use makaron_get_video_status to poll.

Example: Edit a video to add cinematic color grading:
  videoUrl: "https://...", editPrompt: "Apply warm cinematic color grading with film grain", referType: "base"`,
    {
      videoUrl: z.string().url().describe('Video URL to edit (MP4/MOV, ≥3s, 720-2160px, ≤200MB)'),
      editPrompt: z.string().describe('Editing instructions describing what to change'),
      images: z.array(z.string().url()).max(7).optional().describe('Optional reference images (public URLs)'),
      duration: z.number().optional().describe('Output duration: 3, 5, 7, 10, or 15 seconds. Omit for smart mode.'),
      aspectRatio: z.string().optional().describe('Aspect ratio: "9:16", "16:9", "1:1"'),
      referType: z.enum(['base', 'feature']).optional().describe('Video role: "base" (edit this video, default) or "feature" (use as style/motion reference)'),
      keepOriginalSound: z.boolean().optional().describe('Keep original video sound (default: false)'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_edit_video');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createVideo({
          script: params.editPrompt,
          images: params.images ?? [],
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          videoUrl: params.videoUrl,
          videoReferType: params.referType ?? 'base',
          keepOriginalSound: params.keepOriginalSound ?? false,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_edit_video', undefined, Date.now() - t0);
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTask ID: ${result.taskId}`
          : result.message }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP edit_video error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.tool(
    'makaron_get_video_status',
    `Poll the status of a video rendering task. Returns status + videoUrl when complete.

Status values:
- pending: task queued
- processing: rendering in progress (typically 3-5 minutes)
- completed: done, videoUrl available
- failed: error occurred

Poll every 10-15 seconds. Do NOT poll in a tight loop.`,
    {
      taskId: z.string().describe('Task ID from makaron_create_video'),
    },
    async (params) => {
      try {
        const result = await getVideoStatus({ taskId: params.taskId });

        let response = result.message;
        if (result.status === 'completed' && result.videoUrl) {
          response += `\n\nVideo URL: ${result.videoUrl}`;
        }
        if (result.status === 'failed' && result.error) {
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

  // ── Music generation ─────────────────────────────────────────────────────

  server.tool(
    'makaron_create_music',
    `Generate background music using Suno AI. Returns a taskId for polling.

- Music generation takes 2-3 minutes. Use makaron_get_music_status to poll.
- Each generation produces 2 tracks — poll returns the first track's URL.
- Default: instrumental (no vocals). Set instrumental=false for vocals.
- Prompt: describe genre, mood, instruments (e.g. "gentle piano, cinematic, warm strings").
- Style: optional genre/mood tags for custom mode (e.g. "lo-fi, ambient, chill").
- Generated audio files are kept for 15 days.`,
    {
      prompt: z.string().describe('Music description: genre, mood, instruments (max 500 chars)'),
      instrumental: z.boolean().optional().describe('Instrumental only, no vocals (default: true)'),
      style: z.string().optional().describe('Genre/mood tags for custom mode (e.g. "lo-fi, ambient")'),
    },
    async (params) => {
      try {
        if (options?.onToolStart) {
          const check = await options.onToolStart('makaron_create_music');
          if (!check.allowed) return { content: [{ type: 'text' as const, text: check.message || 'Insufficient credits' }] };
        }
        const t0 = Date.now();
        const result = await createMusic({
          prompt: params.prompt,
          instrumental: params.instrumental,
          style: params.style,
        });

        if (result.success) {
          await options?.onToolComplete?.('makaron_create_music', undefined, Date.now() - t0);
        }
        return { content: [{ type: 'text' as const, text: result.success
          ? `${result.message}\n\nTask ID: ${result.taskId}`
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
        if (result.status === 'completed' && result.audioUrl) {
          response += `\n\nAudio URL: ${result.audioUrl}`;
          if (result.duration) response += `\nDuration: ${Math.round(result.duration)}s`;
          if (result.title) response += `\nTitle: ${result.title}`;
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
