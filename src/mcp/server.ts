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

Skills:
- enhance: Professional photo enhancement (cinematic lighting, color grading, depth of field)
- creative: Add playful elements causally linked to the scene
- wild: Exaggerate existing objects in the photo
- captions: Add photorealistic text overlays

Input image can be a local file path (stdio), URL, or base64 data URL.`,
    {
      image: z.string().describe('Input image: local file path, URL, or base64 data URL'),
      editPrompt: z.string().describe('English editing instructions describing what to change'),
      skill: z.enum(['enhance', 'creative', 'wild', 'captions']).optional().describe('Activate a skill template for structured editing'),
      model: z.enum(['gemini', 'qwen', 'pony', 'wai']).optional().describe('Preferred model. enhance→qwen recommended. Gemini refused→retry with qwen. pony/wai=txt2img only.'),
      originalImage: z.string().optional().describe('Original photo URL/base64 for face restoration reference'),
      referenceImages: z.array(z.string()).optional().describe('Additional reference images (up to 3)'),
      useOriginalAsReference: z.boolean().optional().describe('Use originalImage as reference for face/color restoration'),
      aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
    },
    async (params) => {
      try {
        const image = resolveImage(params.image);
        const result = await editImage(
          {
            editPrompt: params.editPrompt,
            skill: params.skill,
            preferredModel: params.model,
            useOriginalAsReference: params.useOriginalAsReference,
            aspectRatio: params.aspectRatio,
          },
          {
            currentImage: image,
            originalImage: params.originalImage ? resolveImage(params.originalImage) : undefined,
            referenceImages: params.referenceImages?.map(resolveImage),
          },
        );

        if (!result.success || !result.image) {
          return { content: [{ type: 'text' as const, text: result.message }] };
        }
        return formatResult(result.image, result.message, 'edit');
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
