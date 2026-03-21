import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { editImage } from '../lib/skills/edit-image';
import { rotateCamera } from '../lib/skills/rotate-camera';

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

export function createMakaronMcpServer() {
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
Input image can be a local file path (stdio), URL, or base64 data URL. Omit image for text-to-image generation.`,
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
        const image = params.image ? resolveImage(params.image) : undefined;
        // MCP callers may send simple/Chinese instructions — wrap to ensure image generation
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
        const image = resolveImage(params.image);
        const result = await rotateCamera(
          { azimuth: params.azimuth, elevation: params.elevation, distance: params.distance },
          { currentImage: image },
        );

        if (!result.success || !result.image) {
          return { content: [{ type: 'text' as const, text: result.message }] };
        }
        return formatResult(result.image, result.message, 'rotate');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[MCP rotate_camera error]', msg);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );

  return server;
}
