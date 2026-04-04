import { streamText, tool, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import sharp from 'sharp';
import type { ModelId } from './models/types';
import { filterAndRemapImages } from './kling';
import { buildCameraPrompt, snapToNearest, AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS } from './camera-utils';
import { InferenceClient } from '@huggingface/inference';
import { editImage } from './skills/edit-image';
import { rotateCamera } from './skills/rotate-camera';
import { createVideo } from './skills/create-video';
import agentPrompt from './prompts/agent.md';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
import captionsPrompt from './prompts/captions.md';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import animatePrompt from './prompts/animate.md';
import type { Tip } from '@/types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION?.trim(),
  accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
});
const MODEL = bedrock('us.anthropic.claude-sonnet-4-6');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentContext {
  currentImage: string;       // base64 data URL – updated after each generation
  originalImage?: string;     // base64 data URL – the very first image, never changes
  referenceImages?: string[]; // base64 data URLs – user-uploaded references (up to 3)
  projectId: string;
  /** Images generated during this run (base64). Streamed to frontend out-of-band. */
  generatedImages: string[];
  /** Which model was used for the last image generation */
  lastUsedModel?: ModelId;
  /** User's preferred model override */
  preferredModel?: ModelId;
  /** Supabase Storage URLs for animation (set when in animation mode) */
  animationImageUrls?: string[];
  /** Task ID + prompt set by generate_animation tool, emitted as animation_task event */
  animationTaskId?: string;
  animationPrompt?: string;
  /** All snapshot images (URL preferred, base64 fallback). index 0 = <<<image_1>>> */
  snapshotImages: string[];
  /** 0-based index of the snapshot the user is currently viewing */
  currentSnapshotIndex: number;
  /** NSFW flag — set when Gemini refuses content. All subsequent calls skip Gemini. */
  isNsfw?: boolean;
  /** User skills loaded from DB (for reference image lookup) */
  userSkills?: ParsedSkill[];
}

export type AgentStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'content'; text: string }
  | { type: 'new_turn' }  // signals start of a new assistant response (after tool result)
  | { type: 'image'; image: string; usedModel?: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown>; images?: string[] }
  | { type: 'animation_task'; taskId: string; prompt: string }  // emitted when generate_animation tool creates a task
  | { type: 'image_analyzed'; imageIndex: number }  // emitted after analyze_image completes (1-based)
  | { type: 'nsfw_detected' }  // emitted when Gemini blocks content — session switches to Qwen-only
  | { type: 'done' }
  | { type: 'error'; message: string };

// Skill types (workspace replaces hardcoded SKILL_PROMPTS map)
import { type ParsedSkill } from './skill-registry';
// Workspace service — unified access to skills, memory, assets
import * as workspace from './workspace';

// ---------------------------------------------------------------------------
// System prompt (bundled via webpack asset/source)
// ---------------------------------------------------------------------------

function getAgentSystemPrompt(): string {
  return agentPrompt + '\n\n## Video Script Format\n\n' + animatePrompt;
}

/** Build system prompt with lightweight skill manifest (not full templates) */
async function buildSystemPrompt(userSkills?: ParsedSkill[]): Promise<string> {
  const base = getAgentSystemPrompt();
  const manifest = await workspace.getSkillManifest(undefined, undefined);
  // Append user skills to manifest if any
  let userSkillLines = '';
  if (userSkills?.length) {
    userSkillLines = '\n' + userSkills.map(s =>
      `- **${s.name}**: ${s.description.trim().split('\n')[0]}${s.makaron?.referenceImages?.length ? ' [has reference images]' : ''}`
    ).join('\n');
  }
  const workspaceSection = `

## Workspace

You have a persistent workspace with two areas:
- **skills/** — your abilities and knowledge (built-in + ones you create)
- **memory/** — your long-term memory (preferences, lessons, plans)

Tools: \`list_files\`, \`read_file\`, \`write_file\`, \`delete_file\`, \`run_code\`

### run_code
Execute JavaScript with access to \`sharp\` (image processing) and snapshot images.
Use for: cropping, resizing, compositing, adding text/overlays, color analysis, batch operations, creating skills with assets.
When user asks to crop, resize, add text/watermark, make collages, or any image manipulation that doesn't need AI generation — use \`run_code\` instead of \`generate_image\`.

This conversation will end, but your workspace stays. When you discover something worth remembering — user preferences, successful techniques, lessons from failures — write it down. When a new conversation starts, check if you left yourself anything useful.

### Writing memory
Be concise. One actionable insight per line — not a diary. Good memory reads like a cheat sheet:
- "User prefers warm film tones over cool digital" ✓
- "Small faces: skip facial micro-adjustments, use body language" ✓
- "The user uploaded a photo and I noticed they seemed to like warm colors because the sunset was beautiful and..." ✗ too verbose

### Creating skills
Before writing a new skill, read \`skills/SKILL_README.md\` first — it has the exact format (YAML frontmatter + markdown body). Also read an existing skill (e.g. \`skills/makaron-mascot/SKILL.md\`) as a reference.

A good skill is **reusable across any project** — it describes a style, technique, or character, not a specific photo:
- "Warm film tone: amber highlights, faded shadows, grain" ✓ reusable
- "This lego worker photo needs warm lighting on the forklift" ✗ project-specific, put in project memory instead

If something only applies to the current project, write it to \`projects/{id}/memory/\` — not as a skill.

For project-specific content, use \`projects/{projectId}/\` paths.
${manifest}${userSkillLines}
`;
  return base + workspaceSection;
}

// ---------------------------------------------------------------------------
// Tools (Vercel AI SDK style, closure over AgentContext)
// ---------------------------------------------------------------------------

function createTools(ctx: AgentContext) {
  return {
    generate_image: tool({
      description: generateImageToolPrompt,
      inputSchema: z.object({
        editPrompt: z.string().describe('The specific creative direction for this edit (English). When skill is set, write only the direction — template rules are auto-injected.'),
        skill: z.string().optional().describe('Activate a skill template (e.g. enhance, creative, wild, captions, makaron-mascot). See tool description and available skills.'),
        model: z.enum(['gemini', 'qwen', 'pony', 'wai']).optional().describe('NEVER set this unless the user literally says a model name like "用pony" or "use qwen". For NSFW after Gemini refusal, set "qwen". Otherwise ALWAYS omit — the router handles everything automatically. Setting this without explicit user request is a bug.'),
        useOriginalAsReference: z.boolean().optional().describe('Set true when you judge that the original photo would help as a reference — e.g. face has drifted, colors changed, user wants to restore something, or after many edits. Default false = single image edit.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
        image_index: z.number().optional().describe('1-based index of the snapshot to edit (<<<image_1>>> = 1, <<<image_2>>> = 2, ...). Omit to edit the current snapshot. Use when user references a previous version.'),
        reference_image_indices: z.array(z.number()).optional().describe('1-based indices of snapshots to use as reference images (e.g. [1, 3] to reference <<<image_1>>> and <<<image_3>>>). Use when combining elements from multiple snapshots — e.g. "use the person from image_1 and the background from image_2". The editPrompt should describe how to combine them (e.g. "Place the person from Image 2 into the scene of Image 1").'),
      }),
      execute: async ({ editPrompt, skill, model, useOriginalAsReference, aspectRatio, image_index, reference_image_indices }) => {
        // Resolve which image to edit — image_index overrides currentImage
        let editTarget = ctx.currentImage;
        if (image_index !== undefined) {
          const idx = image_index - 1;
          if (idx < 0 || idx >= ctx.snapshotImages.length) {
            return { success: false as const, message: `Invalid image_index ${image_index}. Available: 1-${ctx.snapshotImages.length}` };
          }
          editTarget = ctx.snapshotImages[idx];
        }

        // Resolve reference images: user-uploaded + snapshot indices
        // Note: skill reference images are no longer auto-injected here.
        // The Agent discovers them via list_files and passes them as reference_image_indices.
        let resolvedRefs = ctx.referenceImages ? [...ctx.referenceImages] : [];
        console.log(`🎯 [generate_image] skill="${skill || 'none'}" refs=${resolvedRefs.length} editPrompt="${editPrompt.slice(0, 80)}"`);
        if (reference_image_indices?.length) {
          for (const refIdx of reference_image_indices) {
            const idx = refIdx - 1;
            if (idx >= 0 && idx < ctx.snapshotImages.length) {
              resolvedRefs.push(ctx.snapshotImages[idx]);
            }
          }
        }

        // Priority: UI selector > agent tool param > auto-route
        const resolvedModel = (ctx.preferredModel ? ctx.preferredModel : model) as ModelId | undefined;
        const skillResult = await editImage(
          { editPrompt, skill: skill as 'enhance' | 'creative' | 'wild' | 'captions' | undefined, useOriginalAsReference, aspectRatio, preferredModel: resolvedModel, isNsfw: ctx.isNsfw },
          { currentImage: editTarget, originalImage: ctx.originalImage, referenceImages: resolvedRefs.length ? resolvedRefs : undefined },
        );
        // NSFW detection: flag session so all subsequent calls skip Gemini
        if (skillResult.contentBlocked) ctx.isNsfw = true;
        if (skillResult.image) {
          ctx.currentImage = skillResult.image;
          ctx.snapshotImages.push(skillResult.image); // Append as <<<image_N+1>>>
          ctx.generatedImages.push(skillResult.image);
          if (skillResult.usedModel) ctx.lastUsedModel = skillResult.usedModel;
        }
        const indexInfo = skillResult.image ? ` Now <<<image_${ctx.snapshotImages.length}>>>.` : '';
        return { success: skillResult.success as true, message: skillResult.message + indexInfo, contentBlocked: skillResult.contentBlocked };
      },
    }),

    generate_animation: tool({
      description: 'Submit a video script for rendering. Write the script yourself first (streamed to user in chat, following the Video Script Format in your system prompt), then call this tool to submit it.',
      inputSchema: z.object({
        story_prompt: z.string().describe('The video script. First line = short title (2-5 words), then Shot lines with <<<image_N>>> references, camera directions, sound cues, ending with Style line. Follow the Video Script Format in system prompt.'),
        duration: z.number().optional().describe('Duration in seconds: 3, 5, 7, 10, or 15. Omit for smart mode (API decides).'),
      }),
      execute: async ({ story_prompt, duration }) => {
        // GUI animation mode: use animationImageUrls; CUI mode: fallback to snapshotImages URLs
        let imageUrls = ctx.animationImageUrls;
        if (!imageUrls?.length) {
          imageUrls = ctx.snapshotImages.filter(img => img.startsWith('http'));
        }
        if (!imageUrls?.length) {
          return { success: false as const, message: 'No image URLs available yet — images may still be uploading. Please wait and try again.' };
        }
        try {
          // Call skill layer: createVideo (stateless, no DB)
          const skillResult = await createVideo({
            script: story_prompt,
            images: imageUrls,
            duration,
          });

          if (!skillResult.success || !skillResult.taskId) {
            return { success: false as const, message: skillResult.message };
          }

          const taskId = skillResult.taskId;

          // Persist to DB (Agent layer responsibility)
          const { createClient } = await import('@/lib/supabase/server');
          const supabase = await createClient();
          const { filteredImages, finalPrompt } = filterAndRemapImages(story_prompt, imageUrls);
          const { data: animation, error } = await supabase
            .from('project_animations')
            .insert({
              project_id: ctx.projectId,
              piapi_task_id: taskId,
              status: 'processing',
              prompt: finalPrompt,
              snapshot_urls: filteredImages,
            })
            .select('id')
            .single();

          if (error) throw error;

          ctx.animationTaskId = taskId;
          ctx.animationPrompt = story_prompt;
          return { success: true as const, taskId, message: 'Video generation task created! It takes about 3–5 minutes. The result will appear here when done.' };
        } catch (e) {
          return { success: false as const, message: String(e) };
        }
      },
    }),

    analyze_image: tool({
      description: 'See and analyze a photo. Returns the image so you can view it directly with your vision capabilities. Use image_index to look at any snapshot in the timeline.',
      inputSchema: z.object({
        question: z.string().optional().describe('Optional focus area for the analysis'),
        image_index: z.number().optional().describe('1-based index of the snapshot to analyze (<<<image_1>>> = 1, etc.). Omit to analyze the current image.'),
      }),
      execute: async ({ question, image_index }) => {
        // Resolve which image to analyze
        let imageSource = ctx.currentImage;
        if (image_index !== undefined) {
          const idx = image_index - 1;
          if (idx >= 0 && idx < ctx.snapshotImages.length) {
            imageSource = ctx.snapshotImages[idx];
          }
        }

        // No image available (text-to-image mode, no uploads yet)
        if (!imageSource) {
          return { base64Data: '', mimeType: 'image/jpeg', question, error: 'No image available to analyze. Generate an image first using generate_image.' };
        }

        // Resolve image to base64 buffer — handles both URL and base64 input
        let buf: Buffer;
        if (imageSource.startsWith('http')) {
          const res = await fetch(imageSource);
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          const raw = imageSource.replace(/^data:image\/\w+;base64,/, '');
          buf = Buffer.from(raw, 'base64');
        }
        // Compress for analysis — vision doesn't need full resolution, ~600KB is enough
        if (buf.length > 600_000) {
          buf = Buffer.from(await sharp(buf)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer());
        }
        const base64Data = buf.toString('base64');
        const mimeType = 'image/jpeg';
        return { base64Data, mimeType, question };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toModelOutput({ output }: { output: any }) {
        // No image available — return text-only error
        if (!output.base64Data || output.error) {
          return {
            type: 'content' as const,
            value: [{ type: 'text' as const, text: output.error || 'No image available to analyze.' }],
          };
        }
        return {
          type: 'content' as const,
          value: [
            { type: 'media' as const, data: output.base64Data, mediaType: output.mimeType },
            {
              type: 'text' as const,
              text: output.question
                ? `Analyze the image above, focusing on: ${output.question}`
                : 'Analyze this image in detail for photo editing purposes.',
            },
          ],
        };
      },
    }),

    rotate_camera: tool({
      description: `Rotate the virtual camera around the subject to show a different perspective/angle.
Use this when the user wants to see the image from a different viewpoint — e.g. "show from the side", "bird's eye view", "rotate left", "show the back", "zoom in".
This uses Qwen Image Edit to regenerate the image from the requested camera angle.

Parameters:
- azimuth: horizontal rotation (0=front, 45=front-right, 90=right, 135=back-right, 180=back, 225=back-left, 270=left, 315=front-left)
- elevation: vertical angle (-30=low angle, 0=eye level, 30=elevated, 60=high angle)
- distance: zoom (0.6=close-up, 1.0=medium, 1.4=wide shot)`,
      inputSchema: z.object({
        azimuth: z.number().min(0).max(360).describe('Horizontal rotation degrees (0=front, 90=right, 180=back, 270=left)'),
        elevation: z.number().min(-30).max(60).describe('Vertical angle degrees (-30=low, 0=eye level, 30=elevated, 60=high)'),
        distance: z.number().min(0.6).max(1.4).describe('Zoom distance (0.6=close-up, 1.0=medium, 1.4=wide)'),
      }),
      execute: async ({ azimuth, elevation, distance }) => {
        const skillResult = await rotateCamera(
          { azimuth, elevation, distance },
          { currentImage: ctx.currentImage },
        );
        if (skillResult.image) {
          ctx.currentImage = skillResult.image;
          ctx.generatedImages.push(skillResult.image);
        }
        return { success: skillResult.success as true, message: skillResult.message };
      },
    }),

    // ── Workspace tools ─────────────────────────────────────────────────────

    list_files: tool({
      description: `List files in your workspace. Discover available skills, reference images, and your memory.
Returns an array of file entries with path, type, and metadata.
Use pattern to filter: "skills/*" for all skills, "skills/enhance/*" for a specific skill, "memory/*" for your memory.`,
      inputSchema: z.object({
        pattern: z.string().optional().describe('Glob-like filter: "skills/*", "skills/*/assets/*", "memory/*", "prompts/*"'),
        scope: z.enum(['global', 'user', 'project']).optional().describe('Filter by scope. global=built-in, user=user skills+memory, project=project memory. Omit for all.'),
        type: z.string().optional().describe('Filter by content type prefix: "text" for .md files, "image" for images'),
      }),
      execute: async ({ pattern, scope, type }) => {
        const files = await workspace.listFiles({
          scope,
          projectId: ctx.projectId,
          pattern,
          type,
        });

        const result = files.map(f => ({
          path: f.path,
          scope: f.scope,
          type: f.contentType,
          size: f.size,
        }));

        return { files: result, count: result.length };
      },
    }),

    read_file: tool({
      description: `Read a file from your workspace. For .md files, returns text content. For images, returns the image so you can view it.
Use this to read skill instructions (SKILL.md), reference images, or your memory.`,
      inputSchema: z.object({
        path: z.string().describe('File path from list_files, e.g. "skills/enhance/SKILL.md" or "skills/makaron-mascot/assets/character-sheet.jpg"'),
      }),
      execute: async ({ path: filePath }) => {
        const result = await workspace.readFile(filePath, undefined, { projectId: ctx.projectId });
        if (!result) return { error: `File not found: ${filePath}` };

        if (result.contentType.startsWith('image/')) {
          // Return image for vision — same pattern as analyze_image
          const raw = result.content.replace(/^data:image\/\w+;base64,/, '');
          return { base64Data: raw, mimeType: result.contentType, path: filePath };
        }

        return { content: result.content, type: result.contentType, path: filePath };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (output.base64Data) {
          return {
            type: 'content' as const,
            value: [
              { type: 'media' as const, data: output.base64Data, mediaType: output.mimeType },
              { type: 'text' as const, text: `Workspace image: ${output.path}` },
            ],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: `[${output.path}]\n\n${output.content}` }],
        };
      },
    }),

    write_file: tool({
      description: `Write a file to your workspace. Use this to save memory, create skills, or organize your workspace.
Path is free — you decide how to organize. Convention: skills/ for abilities, memory/ for remembering things, projects/{id}/ for project-specific content.`,
      inputSchema: z.object({
        path: z.string().describe('File path, e.g. "memory/preferences.md", "skills/my-style/SKILL.md", "projects/{id}/memory/plan.md"'),
        content: z.string().describe('File content (markdown recommended)'),
      }),
      execute: async ({ path: filePath, content }) => {
        // Determine scope from path
        const isProject = filePath.startsWith('projects/');
        try {
          const fs = require('fs') as typeof import('fs');
          const pathMod = require('path') as typeof import('path');
          const baseDir = isProject
            ? pathMod.join(process.cwd(), '.workspace')
            : pathMod.join(process.cwd(), '.workspace', '_user');
          const fullPath = pathMod.join(baseDir, filePath);
          const dir = pathMod.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf-8');
          return { success: true, message: `Saved: ${filePath}` };
        } catch (e) {
          return { success: false, message: `Write failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    delete_file: tool({
      description: `Delete a file from your workspace. Use this to clean up outdated memory or reorganize.`,
      inputSchema: z.object({
        path: z.string().describe('File path to delete'),
      }),
      execute: async ({ path: filePath }) => {
        try {
          const fs = require('fs') as typeof import('fs');
          const pathMod = require('path') as typeof import('path');
          // Try project path first, then user path
          const candidates = [
            pathMod.join(process.cwd(), '.workspace', filePath),
            pathMod.join(process.cwd(), '.workspace', '_user', filePath),
          ];
          for (const fullPath of candidates) {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              return { success: true, message: `Deleted: ${filePath}` };
            }
          }
          return { success: false, message: `File not found: ${filePath}` };
        } catch (e) {
          return { success: false, message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    run_code: tool({
      description: `Execute JavaScript code with access to image processing libraries and project context.

Use this for any task that requires computation:
- Image manipulation: crop, resize, composite, watermark, color analysis (sharp)
- Layout/design generation: social media covers, before/after comparisons, brand materials (satori — write HTML/CSS, get PNG)
- Data processing: extract colors, analyze image stats, batch operations
- Skill creation with assets: upload images to storage, build SKILL.md, save to database

Available in your code:
- \`sharp\` — image processing (sharp npm package). Example: \`const img = sharp(buffer); const out = await img.resize(800).jpeg().toBuffer();\`
- \`ctx.snapshotImages\` — array of snapshot URLs/base64 (index 0 = <<<image_1>>>)
- \`ctx.projectId\`, \`ctx.userId\` — current project and user IDs
- \`fetch\` — make HTTP requests (e.g. download snapshot images from URLs)
- Standard Node.js: Buffer, JSON, Math, Date, etc.

Your code must return a value. If returning an image, return \`{ type: 'image', data: base64String, mimeType: 'image/jpeg' }\`.
For text results, return \`{ type: 'text', content: 'your result' }\`.
For errors, return \`{ type: 'error', message: 'what went wrong' }\`.`,
      inputSchema: z.object({
        code: z.string().describe('JavaScript code to execute. Must return a result object.'),
        description: z.string().optional().describe('Brief description of what this code does'),
      }),
      execute: async ({ code, description: desc }) => {
        console.log(`🔧 [run_code] ${desc || 'executing code'}...`);
        const startTime = Date.now();
        try {
          // Build sandbox context
          const sandbox = {
            sharp,
            fetch: globalThis.fetch,
            Buffer,
            JSON,
            Math,
            Date,
            console: { log: (...args: unknown[]) => console.log('[run_code]', ...args) },
            ctx: {
              snapshotImages: ctx.snapshotImages,
              snapshotCount: ctx.snapshotImages.length,
              projectId: ctx.projectId,
              userId: '', // TODO: pass userId when available
            },
          };

          // Wrap code in async function and execute
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction(
            ...Object.keys(sandbox),
            `'use strict';\n${code}`
          );

          // Execute with timeout
          const timeoutMs = 30_000;
          const result = await Promise.race([
            fn(...Object.values(sandbox)),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Code execution timed out (30s)')), timeoutMs)),
          ]);

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ [run_code] done in ${elapsed}s, result type: ${typeof result}, isBuffer: ${Buffer.isBuffer(result)}, keys: ${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'}, dataIsBuffer: ${result?.data ? Buffer.isBuffer(result.data) : 'no data'}`);

          // Handle result types — be flexible about what Agent returns
          if (!result) {
            return { type: 'text' as const, content: 'Code executed but returned nothing. Make sure to return a value.' };
          }

          // Helper: convert anything buffer-like to base64 string
          const toBase64 = (data: unknown): string | null => {
            if (Buffer.isBuffer(data)) return data.toString('base64');
            if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
            if (typeof data === 'string' && data.length > 100) return data; // already base64
            return null;
          };

          // Buffer or Uint8Array → treat as image
          const directB64 = toBase64(result);
          if (directB64) {
            return { type: 'image' as const, base64Data: directB64, mimeType: 'image/jpeg', description: desc };
          }

          // { type: 'image', data: ... } — standard format
          if (result.type === 'image' && result.data) {
            const b64 = toBase64(result.data) || String(result.data);
            return { type: 'image' as const, base64Data: b64, mimeType: result.mimeType || 'image/jpeg', description: desc };
          }

          // { buffer: ... } — sharp output shorthand
          if (result.buffer) {
            const b64 = toBase64(result.buffer);
            if (b64) return { type: 'image' as const, base64Data: b64, mimeType: result.mimeType || 'image/jpeg', description: desc };
          }

          // Error result
          if (result.type === 'error') {
            return { type: 'text' as const, content: `Error: ${result.message}` };
          }

          // Text result
          if (result.type === 'text') {
            return { type: 'text' as const, content: String(result.content) };
          }

          // Fallback: stringify
          return { type: 'text' as const, content: JSON.stringify(result, null, 2) };
        } catch (e) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`❌ [run_code] failed in ${elapsed}s:`, msg);
          return { type: 'text' as const, content: `Code execution error: ${msg}` };
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toModelOutput({ output }: { output: any }) {
        if (output.type === 'image' && output.base64Data) {
          return {
            type: 'content' as const,
            value: [
              { type: 'media' as const, data: output.base64Data, mediaType: output.mimeType || 'image/jpeg' },
              { type: 'text' as const, text: output.description ? `Code output: ${output.description}` : 'Code produced an image.' },
            ],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: output.content || 'Code executed successfully.' }],
        };
      },
    }),

  };
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

/** Append a language reply instruction to any prompt based on locale.
 *  Only appends when locale is explicitly set — undefined means no override. */
export function withLocale(prompt: string, locale?: string): string {
  if (locale === 'en') return `${prompt}\n\nReply in English.`;
  if (locale === 'zh') return `${prompt}\n\nReply in Chinese.`;
  return prompt;
}

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `描述这张照片里的内容，1-2句，语气像朋友分享。直接从主体开始说（"一个..."/"画面里..."）。禁止用"我来看看"/"让我看一下"等任何铺垫语。`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `P完图了，看看效果。以"P完之后，"开头，用1句话描述一下现在这张图的整体效果和氛围。禁止用"我来看看"等铺垫语，直接说结果。`;

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,
  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; tipReactionOnly?: boolean; originalImage?: string; referenceImages?: string[]; animationImageUrls?: string[]; animationImages?: string[]; locale?: string; preferredModel?: ModelId; snapshotImages?: string[]; currentSnapshotIndex?: number; isNsfw?: boolean; userSkills?: ParsedSkill[] },
): AsyncGenerator<AgentStreamEvent> {
  const ctx: AgentContext = {
    currentImage,
    originalImage: options?.originalImage,
    referenceImages: options?.referenceImages,
    projectId,
    generatedImages: [],
    animationImageUrls: options?.animationImageUrls,
    preferredModel: options?.preferredModel,
    snapshotImages: (options?.snapshotImages ?? [currentImage]).filter(img => img.length > 0),
    currentSnapshotIndex: options?.currentSnapshotIndex ?? 0,
    isNsfw: options?.isNsfw,
    userSkills: options?.userSkills,
  };

  const allTools = createTools(ctx);
  let imagesSent = 0;
  let stepCount = 0;
  let toolCallStartTime = 0;
  const agentStartTime = Date.now();

  const analysisOnly = options?.analysisOnly ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : 30;
  const analysisPrompt = withLocale(
    options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL,
    options?.locale,
  );

  // Determine which tools to expose
  // tipReactionOnly: no tools (text-only response)
  // analysisOnly: only analyze_image (agent uses tool to see the photo)
  // normal chat / animation: all tools including workspace (agent.md controls behavior)
  const tools = tipReactionOnly ? undefined : analysisOnly
    ? { analyze_image: allTools.analyze_image }
    : allTools;

  // Build user message content — animation mode includes all snapshot images as visual content
  const animImages = options?.animationImages;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userContent: any;
  if (animImages?.length && !analysisOnly && !tipReactionOnly) {
    // Multi-image user message: text + all snapshot images
    userContent = [
      { type: 'text' as const, text: prompt },
      ...animImages.map((img: string) =>
        img.startsWith('data:')
          ? { type: 'image' as const, image: img }
          : { type: 'image' as const, image: new URL(img) }
      ),
    ];
  } else {
    userContent = analysisOnly ? analysisPrompt : prompt;
  }

  // Build system prompt: base agent.md + workspace manifest (lightweight, not full templates)
  const systemPrompt = await buildSystemPrompt(options?.userSkills);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (streamText as any)({
      model: MODEL,
      system: [{ role: 'system', content: systemPrompt, providerOptions: { bedrock: { cachePoint: { type: 'default' } } } }],
      messages: [{ role: 'user', content: userContent }],
      ...(tools ? { tools } : {}),
      ...(analysisOnly && tools ? { activeTools: ['analyze_image'] } : {}),
      stopWhen: stepCountIs(maxSteps),
      onStepFinish: () => { stepCount++; },
    });

    for await (const event of result.fullStream) {
      // ── Text delta ──────────────────────────────────────────────────────────
      if (event.type === 'text-delta') {
        yield { type: 'content', text: event.text };
        continue;
      }

      // ── Tool call ───────────────────────────────────────────────────────────
      if (event.type === 'tool-call') {
        toolCallStartTime = Date.now();
        console.log(`⏱️ [agent] tool-call "${event.toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s`);
        const isEnLocale = options?.locale === 'en';
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: isEnLocale
            ? (q ? `Analyzing image: ${q.slice(0, 30)}` : 'Analyzing image')
            : (q ? `分析图片：${q.slice(0, 25)}` : '分析图片') };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: isEnLocale ? 'Generating image...' : '生成图片中...' };
        } else if (event.toolName === 'list_files') {
          yield { type: 'status', text: isEnLocale ? 'Browsing workspace...' : '浏览工作台...' };
        } else if (event.toolName === 'read_file') {
          const p = (event.input as { path?: string }).path || '';
          yield { type: 'status', text: isEnLocale ? `Reading ${p.split('/').pop()}...` : `读取 ${p.split('/').pop()}...` };
        } else if (event.toolName === 'write_file') {
          yield { type: 'status', text: isEnLocale ? 'Saving...' : '保存中...' };
        } else if (event.toolName === 'delete_file') {
          yield { type: 'status', text: isEnLocale ? 'Deleting...' : '删除中...' };
        } else if (event.toolName === 'run_code') {
          const desc = (event.input as { description?: string }).description;
          yield { type: 'status', text: isEnLocale ? `Running: ${desc || 'code'}...` : `执行: ${desc || '代码'}...` };
        } else if (event.toolName === 'rotate_camera') {
          yield { type: 'status', text: isEnLocale ? 'Rotating camera...' : '旋转相机中...' };
        }
        let toolCallImages: string[] | undefined;
        if (event.toolName === 'generate_image') {
          const inp = event.input as { useOriginalAsReference?: boolean; image_index?: number; reference_image_indices?: number[] };
          // Resolve the actual edit target (respects image_index)
          let displayTarget = ctx.currentImage;
          if (inp.image_index !== undefined) {
            const idx = inp.image_index - 1;
            if (idx >= 0 && idx < ctx.snapshotImages.length) {
              displayTarget = ctx.snapshotImages[idx];
            }
          }
          // Resolve reference images from snapshot indices
          const snapshotRefs: string[] = [];
          if (inp.reference_image_indices?.length) {
            for (const refIdx of inp.reference_image_indices) {
              const idx = refIdx - 1;
              if (idx >= 0 && idx < ctx.snapshotImages.length) {
                snapshotRefs.push(ctx.snapshotImages[idx]);
              }
            }
          }
          const twoImageMode = inp.useOriginalAsReference && ctx.originalImage && ctx.originalImage !== displayTarget;
          toolCallImages = [
            displayTarget,
            ...(twoImageMode ? [ctx.originalImage!] : []),
            ...(ctx.referenceImages ?? []),
            ...snapshotRefs,
          ];
        }
        yield {
          type: 'tool_call',
          tool: event.toolName,
          input: event.input as Record<string, unknown>,
          ...(toolCallImages ? { images: toolCallImages } : {}),
        };
        continue;
      }

      // ── Tool result — flush generated images + animation task ───────────────
      if (event.type === 'tool-result') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (event as any).toolName as string | undefined;
        const toolDuration = toolCallStartTime ? ((Date.now() - toolCallStartTime) / 1000).toFixed(1) : '?';
        console.log(`⏱️ [agent] tool-result "${toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (tool took ${toolDuration}s)`);

        // Emit image_analyzed event so frontend can save the description
        if (toolName === 'analyze_image') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const analyzeInput = (event as any).input as { image_index?: number } | undefined;
          const analyzedIdx = analyzeInput?.image_index ?? (ctx.currentSnapshotIndex + 1);
          yield { type: 'image_analyzed', imageIndex: analyzedIdx };
        }

        // run_code image output — push to generatedImages so it appears in CUI
        if (toolName === 'run_code') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const codeResult = (event as any).result as { type?: string; base64Data?: string; mimeType?: string } | undefined;
          if (codeResult?.type === 'image' && codeResult.base64Data) {
            const dataUrl = `data:${codeResult.mimeType || 'image/jpeg'};base64,${codeResult.base64Data}`;
            ctx.generatedImages.push(dataUrl);
            ctx.snapshotImages.push(dataUrl);
          }
        }

        // Detect generate_image failure or NSFW content block
        if (toolName === 'generate_image') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolResult = (event as any).result as { contentBlocked?: boolean } | undefined;
          if (toolResult?.contentBlocked) {
            yield { type: 'nsfw_detected' };
          }
          if (imagesSent === ctx.generatedImages.length) {
            const isEn = options?.locale === 'en';
            yield { type: 'status', text: isEn ? 'Image generation failed' : '图片生成失败' };
          }
        }

        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel };
          imagesSent++;
        }
        if (ctx.animationTaskId) {
          yield { type: 'animation_task', taskId: ctx.animationTaskId, prompt: ctx.animationPrompt || '' };
          ctx.animationTaskId = undefined;
          ctx.animationPrompt = undefined;
        }
        continue;
      }

      // ── Error from stream ──────────────────────────────────────────────────
      if (event.type === 'error') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = (event as any).error;
        const errMsg = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message: errMsg };
        return;
      }

      // ── New step start (after tool result, model begins next turn) ──────────
      if (event.type === 'start-step' && stepCount > 0) {
        yield { type: 'new_turn' };
      }
    }

    // Flush remaining images
    while (imagesSent < ctx.generatedImages.length) {
      yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel };
      imagesSent++;
    }

    console.log(`⏱️ [agent] DONE total ${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (${imagesSent} images, ${stepCount} steps)`);
    yield { type: 'done' };
  } catch (err) {
    console.log(`⏱️ [agent] ERROR at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`);
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Tips Skill: generate tips text using Claude (fast, ~2-3s vs Gemini ~15s)
// ---------------------------------------------------------------------------

const TIPS_JSON_FORMAT_ZH = `\n\n以JSON数组格式输出，只输出JSON：
[{"emoji":"emoji","label":"2-4个中文字","desc":"中文短描述20字以内","editPrompt":"(MUST be in English) Detailed English editing instructions...","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_JSON_FORMAT_EN = `\n\nOutput as JSON array only, no other text:
[{"emoji":"emoji","label":"2-3 English words","desc":"English description under 20 words","editPrompt":"Detailed English editing prompt","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_PROMPTS: Record<'enhance' | 'creative' | 'wild' | 'captions', string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
  captions: captionsPrompt,
};

// Category-specific system prompts (restored from original gemini.ts structure)
const TIPS_CATEGORY_INFO: Record<'enhance' | 'creative' | 'wild' | 'captions', { cn: string; definition: string; selfCheck: string; rules: string }> = {
  enhance: {
    cn: 'enhance（专业增强）',
    definition: 'enhance = 让照片整体变好看（光影/色彩/通透感），变化必须肉眼明显',
    selfCheck: `enhance自检：
- 放在原图旁边，任何人都能一眼看出提升吗？（"看不出变化"=3分）
- 风格与照片情绪匹配吗？（搞笑照片配阴沉暗调=4分）
- 有通透感+景深分离+色调层次吗？
- enhance可以调整构图，但必须基于原图——编辑后还能一眼认出是同一张照片（"画面变化太多了"=3分）
- 编辑后的背景还是原图的背景吗？enhance是提升原图不是生成新图（"背景被换掉了"=3分，"人物都变了"=1分）`,
    rules: `⚠️ enhance的editPrompt必须包含背景锚定：
"Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."`,
  },
  creative: {
    cn: 'creative（趣味创意）',
    definition: 'creative = 往画面里加入一个与画面内容有因果关系的有趣新元素',
    selfCheck: `creative自检（三问全过才输出）：
- Q1 为什么是这个元素？能不能一句话说清"因为画面里有X所以加Y"？说不清=换一个
- Q2 情绪对吗？让人笑/惊喜=好，让人害怕/困惑=换
- Q3 这个创意能用在其他照片上吗？能=太通用=换一个`,
    rules: `creative品质标准：
- 加入的动物/角色必须是photorealistic写实风（cartoon/卡通=贴纸感）
- 足够大且显眼，至少占画面5-10%面积
- 必须与人物有互动/眼神交流，不能像贴纸`,
  },
  wild: {
    cn: 'wild（疯狂脑洞）',
    definition: 'wild = 让画面中已有的物品发生疯狂变化（不是加新东西！）',
    selfCheck: `wild自检（四问全过才输出）：
- Q1 变化的主角是画面中已有的什么东西？指不出来=不是wild
- Q2 变化够大吗？一眼就能看到变化=好。改镜片/眼镜反射内容=太小不够大(3分"眼镜idea傻")
- Q3 变化是基于物品本身特点还是随便套的？表面视觉类比（层状=蛋糕/抹茶、圆形=球）=换一个。"变成食物/饮品"除非厨房场景否则=万金油套路
- Q4 这个变化会不会让人不适/恐怖？→ 换一个有趣的方向`,
    rules: `wild额外规则：只选画面中重要/显眼的元素做变化，不要选边缘模糊的小物件`,
  },
  captions: {
    cn: 'captions（创意文案）',
    definition: 'captions = 为照片添加与内容高度相关的创意文字叠加，字体风格必须与照片情绪一致',
    selfCheck: `captions自检（三问全过才输出）：
- Q1 这段文字只适合这张照片吗？换到其他照片上还合适=太通用=重写
- Q2 字体风格与画面情绪匹配吗？（童趣照配严肃字体=4分，搞笑配优雅花体=3分）
- Q3 有metadata时自然融入了吗？有地点/时间必须结合进文案`,
    rules: `captions品质标准：
- 文字必须是photorealistic渲染，不是卡通贴纸
- 明确写出要叠加的文字内容（不能让Gemini自己编）
- 一个tip只加一句/一行文字，简洁有力
- 两个tip风格必须不同（如一中一英，或一童趣一简洁）`,
  },
};

function buildTipsSystemPrompt(category: 'enhance' | 'creative' | 'wild' | 'captions', locale?: string): string {
  const info = TIPS_CATEGORY_INFO[category];
  const labelNote = category === 'captions'
    ? 'label: 2-3 words, include scene/style context.'
    : 'label: 2-3 words.';
  const base = `Photo editing expert. Analyze image and generate 2 ${category} edit suggestions. ${labelNote} editPrompt in English, highly specific.

${info.definition}

⚠️ 第一步：判断人脸大小！
分析图片时首先判断人脸在画面中的占比：
- 大脸（特写/半身照，脸部占画面>10%）→ 正常处理
- 小脸（全身照/合照/远景/广角，脸部占画面<10%）→ 触发小脸保护模式
小脸保护模式下所有editPrompt必须包含：
"CRITICAL: Faces in this photo are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region in any way. Treat face areas as if they are masked off and invisible to you."
小脸时人物反应只能用身体语言（身体后仰/转头/手指向变化），绝不能要求面部表情变化。

自检框架（输出每个tip前先过一遍）：

${info.selfCheck}

${info.rules}

⚠️ 人脸保真是最大扣分项！涉及人物的editPrompt必须包含：
"Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider or rounder."

⚠️ 所有editPrompt都必须包含背景净化：
"Clean up the scene like a professional photographer would before shooting: remove any object that draws attention away from the main subject but adds no compositional value. Replace cleaned areas with natural-looking continuation of the scene."

2个tip必须选不同方向。结尾加"Do NOT add any text, watermarks, or borders."`;
  // No withLocale — language of label/desc controlled by TIPS_JSON_FORMAT per locale.
  // editPrompt must ALWAYS be English regardless of locale.
  return base;
}

export async function* streamTipsWithClaude(
  imageBase64: string,
  category: 'enhance' | 'creative' | 'wild' | 'captions',
  metadata?: { takenAt?: string; location?: string },
  locale?: string,
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = TIPS_PROMPTS[category];
  const systemPrompt = buildTipsSystemPrompt(category);

  // Build metadata context string
  const metaLines: string[] = [];
  if (metadata?.takenAt) metaLines.push(`拍摄时间：${metadata.takenAt}`);
  if (metadata?.location) metaLines.push(`拍摄地点：${metadata.location}`);
  const metaContext = metaLines.length > 0
    ? `[照片元数据]\n${metaLines.join('\n')}\n（可用于更贴切的创意联想，例如地点特色元素、时间对应的光线氛围等）\n\n`
    : '';

  const userPrompt = `${metaContext}在生成建议之前，先分析这张图片：判断人脸大小；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，给出2条${category}编辑建议。以下是详细规范（必须遵循）：

${template}${locale === 'en' ? TIPS_JSON_FORMAT_EN : TIPS_JSON_FORMAT_ZH}`;

  const { textStream } = streamText({
    model: MODEL,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: dataUrl },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  // Collect full text then parse JSON
  let fullText = '';
  for await (const delta of textStream) {
    fullText += delta;
  }

  // Extract JSON array from response
  const jsonMatch = fullText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return;

  try {
    const tips = JSON.parse(jsonMatch[0]) as Tip[];
    for (const tip of tips) {
      if (tip.label && tip.editPrompt && tip.category) {
        yield tip;
      }
    }
  } catch { /* parse error, yield nothing */ }
}
