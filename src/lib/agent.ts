import { streamText, tool, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import sharp from 'sharp';
import { validateDesign } from './design-harness';
import type { ModelId } from './models/types';
import { filterAndRemapImages } from './kling';
import { buildCameraPrompt, snapToNearest, AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS } from './camera-utils';
import { InferenceClient } from '@huggingface/inference';
import { editImage } from './skills/edit-image';
import { rotateCamera } from './skills/rotate-camera';
import { createVideo } from './skills/create-video';
import { createMusic } from './skills/create-music';
import agentPrompt from './prompts/agent.md';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
import captionsPrompt from './prompts/captions.md';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import animatePrompt from './prompts/animate.md';
import agentCodingPrompt from './prompts/agent-coding.md';
import type { Tip } from '@/types';
import { toPublicStorageUrl } from '@/lib/supabase/storage';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION?.trim(),
  accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
});
const MODEL = bedrock(process.env.AGENT_MODEL || 'us.anthropic.claude-opus-4-6-v1');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentContext {
  currentImage: string;       // base64 data URL – updated after each generation
  originalImage?: string;     // base64 data URL – the very first image, never changes
  referenceImages?: string[]; // base64 data URLs – user-uploaded references (up to 3)
  projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;             // Supabase client for workspace operations
  userId?: string;            // Current user ID for workspace
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
  | { type: 'capture_frame'; frame: number; uploadPath: string; captureId: string }  // request frontend to capture a frame via renderStillOnWeb
  | { type: 'preview_frame_captured'; workspaceUrl: string }  // emitted after preview_frame completes — CUI shows inline
  | { type: 'nsfw_detected' }  // emitted when Gemini blocks content — session switches to Qwen-only
  | { type: 'reasoning_start' }           // new thinking round started
  | { type: 'reasoning'; text: string }  // extended thinking delta
  | { type: 'coding'; text: string }  // tool-input-delta heartbeat — Agent writing code params
  | { type: 'code_stream'; text: string; done?: boolean }  // run_code code streamed in chunks (avoids large SSE events on iOS)
  | { type: 'render'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; published?: boolean; previewUrl?: string }  // Agent React design for browser rendering
  | { type: 'design'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; published?: boolean }  // @deprecated — backward compat alias for 'render'
  | { type: 'music_task'; taskId: string }  // emitted when generate_music tool creates a task — frontend polls
  | { type: 'done' }
  | { type: 'error'; message: string };

// Skill types (workspace replaces hardcoded SKILL_PROMPTS map)
import { type ParsedSkill } from './skill-registry';
// Workspace service — unified access to skills, memory, assets
import * as workspace from './workspace';

// ---------------------------------------------------------------------------
// Shared image reference utilities
// ---------------------------------------------------------------------------

/** Validate a 1-based snapshot index. Returns 0-based index or error. */
function validateImageIndex(snapshotImages: string[], index: number): { idx: number; error?: string } {
  const idx = index - 1;
  if (idx < 0 || idx >= snapshotImages.length) {
    return { idx: -1, error: `Invalid index ${index}. Available: 1-${snapshotImages.length}` };
  }
  if (!snapshotImages[idx]) return { idx: -1, error: 'No image at this index' };
  return { idx };
}

/** Fetch an image source (URL or base64 data URL) into a JPEG Buffer.
 *  Always normalizes to JPEG to avoid MIME type mismatches (e.g. PNG labeled as JPEG). */
async function fetchImageBuffer(
  source: string,
  opts?: { maxBytes?: number; maxPx?: number; quality?: number },
): Promise<Buffer> {
  let buf: Buffer;
  if (source.startsWith('http')) {
    buf = Buffer.from(await (await fetch(source)).arrayBuffer());
  } else {
    buf = Buffer.from(source.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  }
  // Always convert to JPEG — ensures consistent MIME type for Bedrock vision
  const maxPx = opts?.maxPx ?? 2048;
  const quality = opts?.quality ?? 90;
  buf = Buffer.from(await sharp(buf)
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer());
  return buf;
}

// ---------------------------------------------------------------------------
// System prompt (bundled via webpack asset/source)
// ---------------------------------------------------------------------------

function getAgentSystemPrompt(): string {
  return agentPrompt + '\n\n## Video Script Format\n\n' + animatePrompt;
}

/** Build system prompt with lightweight skill manifest (not full templates) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildSystemPrompt(userSkills?: ParsedSkill[], supabase?: any, userId?: string, projectId?: string): Promise<string> {
  const base = getAgentSystemPrompt();
  const manifest = await workspace.getSkillManifest(supabase, userId);
  // Append user skills to manifest if any
  let userSkillLines = '';
  if (userSkills?.length) {
    userSkillLines = '\n' + userSkills.map(s =>
      `- **${s.name}**: ${s.description.trim().split('\n')[0]}${s.makaron?.referenceImages?.length ? ' [has reference images]' : ''}`
    ).join('\n');
  }

  const projectPath = projectId ? `${projectId}/` : '';
  const workspaceSection = `

## Workspace

You have a persistent workspace for skills and files.

Tools: \`list_files\`, \`read_file\`, \`write_file\`, \`delete_file\`, \`run_code\`

### File organization
- **User-level** (shared across projects): \`skills/\`, \`memory/\`
- **Project-level** (current project): \`${projectPath}code/\`${projectId ? ` — save design code here` : ''}
- **skills/{name}/SKILL.md** — Create reusable skills here. Read \`skills/SKILL_README.md\` for the format.

### run_code
Execute JavaScript with design mode (React/CSS) and image utilities (sharp).
When user asks for visual output — use \`run_code\` with design mode instead of \`generate_image\`.
Always tell the user what you're about to do BEFORE calling run_code (1 sentence). After run_code completes, briefly describe the result.

### Creating skills
Before writing a new skill, read \`skills/SKILL_README.md\` first — it has the exact format (YAML frontmatter + markdown body). Also read an existing skill (e.g. \`skills/makaron-mascot/SKILL.md\`) as a reference.

A good skill is **reusable across any project** — it describes a style, technique, or character, not a specific photo.

${manifest}${userSkillLines}
`;

  // Memory injection — read user-level and project-level MEMORY.md
  let memorySection = '';
  if (supabase && userId) {
    try {
      const userMem = await workspace.readFile('memory/MEMORY.md', supabase, userId);
      if (userMem?.content) memorySection += '\n\n## User Memory\n' + userMem.content;
    } catch { /* no user memory yet */ }
    if (projectId) {
      try {
        const projMem = await workspace.readFile(`projects/${projectId}/memory/MEMORY.md`, supabase, userId);
        if (projMem?.content) memorySection += '\n\n## Project Memory\n' + projMem.content;
      } catch { /* no project memory yet */ }
    }
  }

  return base + workspaceSection + memorySection;
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
          const v = validateImageIndex(ctx.snapshotImages, image_index);
          if (v.error) return { success: false as const, message: v.error };
          editTarget = ctx.snapshotImages[v.idx];
        }

        // Resolve reference images: user-uploaded + snapshot indices
        let resolvedRefs = ctx.referenceImages ? [...ctx.referenceImages] : [];
        console.log(`🎯 [generate_image] skill="${skill || 'none'}" refs=${resolvedRefs.length} editPrompt="${editPrompt.slice(0, 80)}"`);
        if (reference_image_indices?.length) {
          for (const refIdx of reference_image_indices) {
            const v = validateImageIndex(ctx.snapshotImages, refIdx);
            if (!v.error) resolvedRefs.push(ctx.snapshotImages[v.idx]);
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
          const v = validateImageIndex(ctx.snapshotImages, image_index);
          if (!v.error) imageSource = ctx.snapshotImages[v.idx];
        }

        if (!imageSource || imageSource.startsWith('__design_pending_')) {
          return { base64Data: '', mimeType: 'image/jpeg', question, error: 'No image available to analyze. Generate an image first using generate_image.' };
        }

        const buf = await fetchImageBuffer(imageSource, { maxBytes: 600_000, maxPx: 1024, quality: 75 });
        return { base64Data: buf.toString('base64'), mimeType: 'image/jpeg', question };
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

    preview_frame: tool({
      description: `Capture a screenshot of your current design at a specific frame or time.
Use this to verify visual output — check key moments in video designs.
For still designs, frame 0 is the only frame.
Returns the rendered image so you can see it with your vision.`,
      inputSchema: z.object({
        frame: z.number().optional().describe('0-based frame number.'),
        timestamp: z.number().optional().describe('Time in seconds (e.g. 2.5). Converted to frame using fps.'),
        question: z.string().optional().describe('What to focus on when viewing this frame.'),
      }),
      execute: async ({ frame, timestamp, question }) => {
        const design = (ctx as any).__lastDesignPayload;
        if (!design) return { error: 'No active design. Use run_code with type: "render" first.' };

        const fps = design.animation?.fps || 30;
        const dur = design.animation?.durationInSeconds || 0;
        const totalFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

        let targetFrame = 0;
        if (frame !== undefined) {
          targetFrame = Math.max(0, Math.min(frame, totalFrames - 1));
        } else if (timestamp !== undefined) {
          targetFrame = Math.max(0, Math.min(Math.round(timestamp * fps), totalFrames - 1));
        }

        try {
          // Server-side Sandbox rendering
          const { renderDesignFrame } = await import('./remotion-server');
          const jpegBuffer = await renderDesignFrame(design, targetFrame);

          const drafts = (ctx as any).__runCodeDrafts || [];
          const b64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
          if (drafts.length > 0) {
            drafts[drafts.length - 1].previewBase64 = b64;
          }

          let wsUrl = '';
          const snapN = ctx.snapshotImages.length;
          const wsPath = `${ctx.projectId}/drafts/design-snap${snapN}-frame${targetFrame}-${Date.now()}.jpg`;
          if (ctx.supabase && ctx.userId) {
            const ws = await workspace.writeFile(wsPath, jpegBuffer, ctx.supabase, ctx.userId, 'image/jpeg');
            if (ws.storageUrl) {
              wsUrl = ws.storageUrl;
              if (drafts.length > 0) drafts[drafts.length - 1].previewUrl = wsUrl;
            }
          }

          console.log(`🖼️ [agent] preview_frame: frame ${targetFrame}/${totalFrames} (${(targetFrame / fps).toFixed(1)}s), ${(jpegBuffer.length / 1024).toFixed(0)} KB (sandbox)`);
          return {
            base64Data: jpegBuffer.toString('base64'),
            mimeType: 'image/jpeg',
            frame: targetFrame,
            totalFrames,
            fps,
            question,
            workspaceUrl: wsUrl,
            workspacePath: wsPath,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`⚠️ [agent] preview_frame failed: ${msg}`);
          return { error: `Failed to capture frame ${targetFrame}: ${msg}` };
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        const time = (output.frame / output.fps).toFixed(1);
        const loc = output.workspacePath ? ` Saved: ${output.workspacePath}` : '';
        return {
          type: 'content' as const,
          value: [
            { type: 'media' as const, data: output.base64Data, mediaType: output.mimeType },
            { type: 'text' as const, text: `Frame ${output.frame}/${output.totalFrames} (${time}s).${loc}${output.question ? ` Focus: ${output.question}` : ''}` },
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
      description: `List files in your workspace. Discover available skills and reference images.
Use pattern to filter: "skills/*" for all skills, "skills/enhance/*" for a specific skill.`,
      inputSchema: z.object({
        pattern: z.string().optional().describe('Glob-like filter: "skills/*", "skills/*/assets/*"'),
      }),
      execute: async ({ pattern }) => {
        const files = await workspace.listFiles(pattern, ctx.supabase, ctx.userId);

        const result = files.map(f => ({
          path: f.path,
          type: f.contentType,
          size: f.size,
          builtIn: f.isBuiltIn || false,
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
        const result = await workspace.readFile(filePath, ctx.supabase, ctx.userId);
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
Set fromLastRunCode=true to save the last run_code output. By default this also PUBLISHES to the timeline. Set publish=false to save code to workspace WITHOUT publishing — useful for saving work-in-progress before you're ready to show the user.
Path is auto-generated as {projectId}/code/snapshot-{N}-{name}.json. Just provide a short name.`,
      inputSchema: z.object({
        path: z.string().optional().describe('File path. Auto-generated when fromLastRunCode=true (just pass name for the slug).'),
        name: z.string().optional().describe('Short descriptive name for the saved code (e.g. "sunset-poster"). Used with fromLastRunCode.'),
        content: z.string().optional().describe('File content. Not needed if fromLastRunCode=true.'),
        fromLastRunCode: z.boolean().optional().describe('Save the last run_code output (design or image). By default also publishes to timeline. Set publish=false to save only.'),
        publish: z.boolean().optional().describe('Whether to publish to timeline. Default true. Set false to save code to workspace without creating a Snapshot.'),
      }),
      execute: async ({ path: filePath, name, content, fromLastRunCode, publish: shouldPublish }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, message: 'Workspace not available (no Supabase connection).' };
        }
        let fileContent = content || '';
        let savePath = filePath || '';
        if (fromLastRunCode) {
          const lastCode = (ctx as any).__lastRunCode;
          if (!lastCode) {
            return { success: false, message: 'No run_code output to save. Call run_code first.' };
          }
          fileContent = lastCode;
          // Auto-generate path: {projectId}/code/snapshot-{N}-{name}.json
          if (!savePath) {
            const snapshotIdx = ctx.snapshotImages.length;
            const slug = (name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
            savePath = `${ctx.projectId}/code/snapshot-${snapshotIdx}-${slug}.json`;
          }
        }
        if (!savePath) {
          return { success: false, message: 'Provide a path or use fromLastRunCode=true.' };
        }
        if (!fileContent) {
          return { success: false, message: 'No content to write. Provide content or set fromLastRunCode=true.' };
        }
        const result = await workspace.writeFile(savePath, fileContent, ctx.supabase, ctx.userId);
        if (!result.success) {
          return { success: false, message: `Write failed: ${result.error}` };
        }

        // Publish: when fromLastRunCode and publish !== false, promote the last draft to a real Snapshot
        if (fromLastRunCode && shouldPublish !== false) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const drafts = (ctx as any).__runCodeDrafts || [];
          const lastDraft = drafts[drafts.length - 1];

          if (lastDraft?.type === 'design') {
            // Design draft → publish via pendingDesign (renders on frontend)
            const designPayload = lastDraft.payload;
            const preview = lastDraft.previewBase64 || '';

            ctx.snapshotImages.push(preview);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any).__pendingDesign = designPayload;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any).__pendingDesignPublished = true;

            console.log(`📌 [agent] design published via write_file: <<<image_${ctx.snapshotImages.length}>>>`);
          } else if (lastDraft?.type === 'image') {
            // Image draft → push to snapshotImages + emit via generatedImages
            const imageData = lastDraft.imageBase64;
            ctx.snapshotImages.push(imageData);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
            ctx.generatedImages.push(imageData);

            console.log(`📌 [agent] image published via write_file: <<<image_${ctx.snapshotImages.length}>>>`);
          }
        }

        return { success: true, message: `Saved: ${savePath}`, storageUrl: toPublicStorageUrl(result.storageUrl || '') };
      },
    }),

    delete_file: tool({
      description: `Delete a file from your workspace. Use this to clean up outdated memory or reorganize.`,
      inputSchema: z.object({
        path: z.string().describe('File path to delete'),
      }),
      execute: async ({ path: filePath }) => {
        try {
          if (!ctx.supabase || !ctx.userId) {
            return { success: false, message: 'Workspace not available.' };
          }
          const ok = await workspace.deleteFile(filePath, ctx.supabase, ctx.userId);
          return ok ? { success: true, message: `Deleted: ${filePath}` } : { success: false, message: `File not found: ${filePath}` };
        } catch (e) {
          return { success: false, message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    run_code: tool({
      description: `Execute JavaScript code with access to image processing libraries and project context.

${agentCodingPrompt}

Use this for any task that requires computation:
- Visual output: design mode (React/CSS) — covers text, layout, images, overlays, animations
- Image utilities: format conversion, metadata reading (sharp)
- Data processing: extract colors, analyze image stats, batch operations
- Skill creation with assets: upload images to storage, build SKILL.md, save to database

Available in your code:
- \`sharp\` — image format conversion and metadata. Example: \`const { width, height } = await sharp(images[0]).metadata();\`
- \`saveToWorkspace(path, content, contentType?)\` — Save a file directly to workspace (Supabase Storage). Returns \`{ success, storageUrl, error }\`. Use for skill assets, exports, etc.
- \`JSZip\` — Create zip files. Example: \`const zip = new JSZip(); zip.file('SKILL.md', text); zip.file('assets/ref.jpg', imgBuffer); const buf = await zip.generateAsync({type:'nodebuffer'}); const {storageUrl} = await saveToWorkspace('exports/skill.zip', buf, 'application/zip');\`
- \`images\` — pre-fetched snapshot Buffers from \`image_refs\` parameter. \`images[0]\` = first ref, \`images[1]\` = second, etc. **Only for sharp operations (metadata, crop, format conversion). Do NOT convert to base64 for design props — use ctx.snapshotImages URLs instead.**
- \`ctx.snapshotImages\` — array of snapshot URLs (index 0 = <<<image_1>>>). **Use these for design props** (e.g. \`props: { snapshotUrl: ctx.snapshotImages[0] }\`). These are lightweight URLs, not base64.
- \`ctx.projectId\`, \`ctx.userId\` — current project and user IDs
- \`fetch\` — make HTTP requests
- Standard Node.js: Buffer, JSON, Math, Date, etc.

Your code must return a value:
- Image (sharp output): return Buffer directly, or \`{ type: 'image', data: base64, mimeType: 'image/jpeg' }\`
- Text: return \`{ type: 'text', content: 'result' }\`
- **Render (React design)**: return \`{ type: 'render', code: '...', width: 1080, height: 1350 }\`. The \`code\` string MUST be a complete named function with an explicit return statement. Available in scope: React, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Series, Img, AbsoluteFill, Audio, evolvePath/getLength/getPointAtLength/interpolatePath/parsePath/resetPath/cutPath (from @remotion/paths — usage: `evolvePath(progress, svgPath)` returns partial path for stroke drawing; `getPointAtLength(svgPath, length)` returns {x,y} for elements following a curve), noise2D/noise3D (from @remotion/noise — usage: `noise2D('seed', x, y)` returns -1 to 1, use for organic backgrounds, grain, waves). Rendered by the browser with full CSS + Google Fonts support.
  **IMPORTANT: Use \`<Img>\` (Remotion) instead of \`<img>\` for all images.** \`<Img>\` ensures images are fully loaded before rendering/screenshot. Plain \`<img>\` causes blank images on mobile.
  **Embed image URLs directly in code using template literals** — do NOT use props for images:
  \`\`\`
  return {
    type: 'render',
    width: 1080, height: 1350,
    code: \\\`function Design() {
      return (<div style={{width:'100%',height:'100%'}}><Img src="\${ctx.snapshotImages[0]}" style={{width:'100%',height:'100%',objectFit:'cover'}} /></div>);
    }\\\`
  }
  \`\`\`
  - **Still** (default): omit \`duration\` — renders as a single image.
  - **Animation**: add \`duration: 5\` (seconds) — renders as a playable video with Remotion Player. Use \`useCurrentFrame()\` + \`interpolate()\` for animation.
- **Patch (incremental edit)**: return \`{ type: 'patch', edits: [{ old: '...', new: '...' }] }\`. Search & replace on current design code. Each edit.old must match exactly once in the code. Use for text changes, style tweaks, minor additions/removals. Optionally include \`props: {...}\` to merge prop updates.
- Error: return \`{ type: 'error', message: 'what went wrong' }\`

**Default to design for all visual output.** Design supports text, layout, images (embed URLs via template literal \\\`\${ctx.snapshotImages[N]}\\\`), CSS crop/overlay/positioning, fonts, emoji — covers nearly all visual tasks. Only use sharp for format conversion (e.g. PNG→JPEG) or reading image metadata.`,
      inputSchema: z.object({
        code: z.string().describe('JavaScript code to execute. Must return a result object.'),
        description: z.string().optional().describe('Brief description of what this code does. For designs/videos, describe the content and visual style (e.g. "15s cinematic video: 4 scenes of temple visit with Ken Burns + fade transitions, Japanese text overlays"). This is stored as the snapshot description — be specific.'),
        image_refs: z.array(z.number()).optional().describe('1-based snapshot indices to pre-fetch as Buffers (e.g. [2, 3] for <<<image_2>>> and <<<image_3>>>). Available in code as images[0], images[1], ... (Buffer order matches this array).'),
      }),
      execute: async ({ code, description: desc, image_refs }) => {
        console.log(`🔧 [run_code] ${desc || 'executing code'}...`);
        const startTime = Date.now();
        // Store raw code for write_file({ fromLastRunCode: true })
        (ctx as any).__lastRunCode = code;

        // Refresh snapshotImages URLs from DB — ensures URLs are valid
        // (fixes race condition where upload is still in progress at request time)
        if (ctx.supabase && ctx.projectId) {
          try {
            const { data: dbSnaps } = await ctx.supabase
              .from('snapshots')
              .select('image_url, sort_order')
              .eq('project_id', ctx.projectId)
              .order('sort_order');
            if (dbSnaps?.length) {
              for (let i = 0; i < Math.min(dbSnaps.length, ctx.snapshotImages.length); i++) {
                const dbUrl = dbSnaps[i]?.image_url;
                if (dbUrl && !ctx.snapshotImages[i].startsWith('http')) {
                  console.log(`📸 [run_code] refreshed snapshotImages[${i}]: base64 → ${dbUrl.substring(0, 80)}`);
                  ctx.snapshotImages[i] = dbUrl;
                }
              }
            }
          } catch (e) {
            console.warn('⚠️ [run_code] failed to refresh snapshot URLs:', e);
          }
        }

        // Debug: log snapshot image URLs available to run_code
        console.log(`📸 [run_code] ctx.snapshotImages (${ctx.snapshotImages.length}):`);
        ctx.snapshotImages.forEach((img, i) => {
          console.log(`  [${i}] ${img ? (img.startsWith('http') ? img : `base64:${img.length}chars`) : 'EMPTY'}`);
        });
        try {
          // Pre-fetch requested snapshot images as Buffers
          let preloadedImages: Buffer[] = [];
          if (image_refs?.length) {
            for (const ref of image_refs) {
              const v = validateImageIndex(ctx.snapshotImages, ref);
              if (v.error) return { type: 'text' as const, content: v.error };
            }
            preloadedImages = await Promise.all(
              image_refs.map(ref => fetchImageBuffer(ctx.snapshotImages[ref - 1]))
            );
            console.log(`📦 [run_code] pre-fetched ${preloadedImages.length} images (${preloadedImages.map(b => `${(b.length / 1024).toFixed(0)}KB`).join(', ')})`);
          }

          // Build sandbox context
          // Helper: save file to workspace directly from run_code (avoids passing large base64 back to Agent)
          const saveToWorkspace = async (path: string, content: string | Buffer, contentType?: string) => {
            if (!ctx.supabase || !ctx.userId) return { success: false, error: 'No Supabase connection' };
            const result = await workspace.writeFile(path, content, ctx.supabase, ctx.userId, contentType);
            return { ...result, storageUrl: result.storageUrl ? toPublicStorageUrl(result.storageUrl) : undefined };
          };

          const JSZip = (await import('jszip')).default;

          const sandbox = {
            sharp,
            saveToWorkspace,
            JSZip,
            images: preloadedImages,
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
              userId: ctx.userId || '',
              supabase: ctx.supabase,
            },
          };

          // Execute in vm sandbox — isolates from process.env, require, fs, etc.
          const vm = require('vm') as typeof import('vm');
          const context = vm.createContext({
            ...sandbox,
            setTimeout, clearTimeout, Promise, // needed for async code
          });

          const wrappedCode = `(async () => { 'use strict';\n${code}\n})()`;
          const script = new vm.Script(wrappedCode);
          const result = await script.runInContext(context, { timeout: 30_000 });

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ [run_code] done in ${elapsed}s, result type: ${typeof result}, isBuffer: ${Buffer.isBuffer(result)}, keys: ${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'}, dataType: ${result?.data ? `${typeof result.data} / ${result.data.constructor?.name} / len=${result.data.length || 'N/A'}` : 'no data'}`);

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

          // Helper: store image as draft (published via write_file)
          const pushImage = (b64: string, mime: string) => {
            const dataUrl = `data:${mime};base64,${b64}`;
            ctx.currentImage = dataUrl;
            // Store as draft — published to timeline via write_file({ fromLastRunCode: true })
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];
            (ctx as any).__runCodeDrafts.push({ type: 'image', imageBase64: dataUrl, previewBase64: dataUrl });
          };

          // { type: 'patch', edits: [...] } — Incremental search & replace on last design
          if (result?.type === 'patch' && Array.isArray(result.edits)) {
            const lastDesign = (ctx as any).__lastDesignPayload;
            if (!lastDesign) {
              return { type: 'text' as const, content: 'No active design to patch. Use type: "render" to create a design first.' };
            }
            let code = lastDesign.code;
            for (const edit of result.edits) {
              if (typeof edit.old !== 'string' || typeof edit.new !== 'string') {
                return { type: 'text' as const, content: 'Patch failed: each edit must have "old" and "new" strings.' };
              }
              const count = code.split(edit.old).length - 1;
              if (count === 0) return { type: 'text' as const, content: `Patch failed: old_string not found in current code.\n"${edit.old.slice(0, 100)}"` };
              if (count > 1) return { type: 'text' as const, content: `Patch failed: old_string matches ${count} times. Add more surrounding context to make it unique.\n"${edit.old.slice(0, 100)}"` };
              code = code.replace(edit.old, edit.new);
            }
            const mergedProps = result.props ? { ...(lastDesign.props || {}), ...result.props } : lastDesign.props;
            const patched = { ...lastDesign, code, props: mergedProps };
            if (result.editables) patched.editables = result.editables;

            const harnessError = validateDesign({ code: patched.code, props: patched.props });
            if (harnessError) return { type: 'text' as const, content: harnessError };

            (ctx as any).__pendingDesign = patched;
            (ctx as any).__pendingDesignPublished = false; // draft — canvas preview only, no snapshot
            (ctx as any).__lastDesignPayload = patched;
            (ctx as any).__lastRunCode = JSON.stringify(patched, null, 2);

            // Track draft for potential later publish via write_file
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];

            // Update last draft (patch updates existing draft, doesn't create new one)
            const drafts = (ctx as any).__runCodeDrafts;
            if (drafts.length > 0) {
              drafts[drafts.length - 1] = { type: 'design', payload: patched };
            } else {
              drafts.push({ type: 'design', payload: patched });
            }

            const draftIdx = drafts.length;
            return { type: 'text' as const, content: `Patched — draft ${draftIdx} updated. Use preview_frame to verify key frames. Publish: write_file({ fromLastRunCode: true, name: "slug" })` };
          }

          // { type: 'render' (or legacy 'design'), code: '...' } — Store for event loop to emit as SSE
          if ((result?.type === 'render' || result?.type === 'design') && typeof result.code === 'string') {
            // Normalize animation struct — agent may return { fps, duration } or { animation: { fps, durationInSeconds } }
            let animation = result.animation;
            if (!animation && (result.fps || result.duration || result.durationInSeconds)) {
              animation = {
                fps: result.fps || 30,
                durationInSeconds: result.durationInSeconds || result.duration || 5,
              };
            }
            // ── Design harness: compile + image reference checks ──
            const harnessError = validateDesign({ code: result.code, props: result.props });
            if (harnessError) {
              return { type: 'text' as const, content: harnessError };
            }

            // ── Harness passed — store design ──
            // Auto-generate description if Agent didn't provide one
            const autoDesc = desc || (() => {
              const type = animation ? `${animation.durationInSeconds}s video` : 'still design';
              // Extract text content from code (string literals in JSX)
              const textMatches = result.code.match(/>([^<>{}\n]{3,60})</g)?.slice(0, 5).map((m: string) => m.slice(1).trim()).filter(Boolean);
              const textHint = textMatches?.length ? `: "${textMatches.slice(0, 3).join('", "')}"` : '';
              return `${type} (${result.width || 1080}x${result.height || 1350})${textHint}`;
            })();
            const designPayload = {
              code: result.code,
              width: result.width || 1080,
              height: result.height || 1350,
              props: result.props,
              animation,
              description: autoDesc,
              ...(result.editables ? { editables: result.editables } : {}),
            };
            (ctx as any).__pendingDesign = designPayload;
            (ctx as any).__pendingDesignPublished = false; // draft — canvas preview only, no snapshot
            (ctx as any).__lastDesignPayload = designPayload;
            // Store for write_file({ fromLastRunCode: true })
            (ctx as any).__lastRunCode = JSON.stringify(designPayload, null, 2);

            // Track draft for potential later publish via write_file
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];

            // Push new draft (no auto-screenshot — Agent uses preview_frame tool to check)
            (ctx as any).__runCodeDrafts.push({ type: 'design', payload: designPayload });
            const draftIdx = (ctx as any).__runCodeDrafts.length;

            return { type: 'text' as const, content: `Design ready — draft ${draftIdx}. Use preview_frame to check key frames, then publish: write_file({ fromLastRunCode: true, name: "<descriptive-slug>" })` };
          }

          // Helper: handle image result from run_code — store as draft + upload preview
          const handleImageResult = async (b64: string, mime: string): Promise<{ type: 'image'; base64Data: string; mimeType: string; description?: string }> => {
            pushImage(b64, mime);
            // Upload preview to workspace so it shows in CUI
            const drafts = (ctx as any).__runCodeDrafts || [];
            const lastDraft = drafts[drafts.length - 1];
            if (lastDraft && ctx.supabase && ctx.userId) {
              try {
                const buf = Buffer.from(b64, 'base64');
                const draftN = drafts.length;
                const draftPath = `${ctx.projectId}/drafts/draft-${draftN}.jpg`;
                const wsResult = await workspace.writeFile(draftPath, buf, ctx.supabase, ctx.userId, mime);
                if (wsResult.storageUrl) lastDraft.previewUrl = wsResult.storageUrl;
              } catch (err) {
                console.warn('⚠️ [agent] image draft upload failed:', (err as Error).message);
              }
            }
            const draftIdx = drafts.length;
            const previewNote = lastDraft?.previewUrl ? ` Preview: ${lastDraft.previewUrl}` : '';
            return { type: 'image' as const, base64Data: b64, mimeType: mime, description: `Image draft ${draftIdx}.${previewNote} Publish: write_file({ fromLastRunCode: true, name: "slug" })` };
          };

          // Buffer or Uint8Array → treat as image
          const directB64 = toBase64(result);
          if (directB64) {
            return handleImageResult(directB64, 'image/jpeg');
          }

          // { type: 'image', data: ... } — standard format
          if (result.type === 'image' && result.data) {
            const b64 = toBase64(result.data) || String(result.data);
            return handleImageResult(b64, result.mimeType || 'image/jpeg');
          }

          // { buffer: ... } — sharp output shorthand
          if (result.buffer) {
            const b64 = toBase64(result.buffer);
            if (b64) {
              return handleImageResult(b64, result.mimeType || 'image/jpeg');
            }
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

    generate_music: tool({
      description: `Generate background music for the current design/video. The system polls in the background and shows music cards in CUI when ready — you do NOT need to poll or wait.
IMPORTANT: Start the prompt with the exact video duration, e.g. "15-second ...". Check the current design's animation.durationInSeconds for the length. This ensures the generated music matches the video.
Prompt tips: genre, mood, instruments, and beat-synced timing sections.
Example for a 15s video: "15-second cinematic, slow strings 0-3s, percussive hit at 3s, rising energy 3-10s, piano fadeout 10-15s"`,
      inputSchema: z.object({
        prompt: z.string().describe('Music description: genre, mood, instruments, beat timing'),
        instrumental: z.boolean().optional().describe('No vocals (default: true)'),
        style: z.string().optional().describe('Genre/mood tags for custom mode'),
      }),
      execute: async ({ prompt, instrumental, style }) => {
        const result = await createMusic({ prompt, instrumental, style });
        if (result.taskId) {
          (ctx as any).musicTaskId = result.taskId;
          // Fire-and-forget: write pending rows to DB for polling resume after reload
          if (ctx.supabase && ctx.userId) {
            Promise.all([0, 1].map(idx =>
              ctx.supabase.from('project_music').upsert({
                suno_task_id: result.taskId,
                track_index: idx,
                project_id: ctx.projectId,
                user_id: ctx.userId,
                prompt,
                status: 'pending',
              }, { onConflict: 'suno_task_id,track_index' })
            )).catch(() => {});
          }
        }
        return result;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; tipReactionOnly?: boolean; originalImage?: string; referenceImages?: string[]; animationImageUrls?: string[]; animationImages?: string[]; locale?: string; preferredModel?: ModelId; snapshotImages?: string[]; currentSnapshotIndex?: number; isNsfw?: boolean; userSkills?: ParsedSkill[]; supabase?: any; userId?: string; currentDesign?: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string } } },
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
    supabase: options?.supabase,
    userId: options?.userId,
  };

  // Pre-load design for patch support across sessions
  if (options?.currentDesign?.code) {
    (ctx as any).__lastDesignPayload = options.currentDesign;
  }

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
    // Inject current design code into prompt so Agent can patch without read_file
    const designInjection = options?.currentDesign?.code
      ? `[Current design code — modify with run_code patch mode, no need to read_file]\n\`\`\`json\n${JSON.stringify({ code: options.currentDesign.code, width: options.currentDesign.width, height: options.currentDesign.height, animation: options.currentDesign.animation })}\n\`\`\`\n\n`
      : '';
    userContent = analysisOnly ? analysisPrompt : (designInjection + prompt);
  }

  // Build system prompt: base agent.md + workspace manifest (lightweight, not full templates)
  const systemPrompt = await buildSystemPrompt(options?.userSkills, options?.supabase, options?.userId, projectId);

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

    // State machine for extracting code from run_code tool-input-delta
    let codeExtractor: { buffer: string; state: 'waiting' | 'in_code' | 'done'; escaped: boolean; sent: number } | null = null;

    for await (const event of result.fullStream) {
      // ── Reasoning events — forward to CUI ──
      if (event.type === 'reasoning-start') {
        yield { type: 'reasoning_start' as const };
        continue;
      }
      if (event.type === 'reasoning-delta') {
        yield { type: 'reasoning' as const, text: (event as any).text || '' };
        continue;
      }
      if (event.type === 'reasoning-end') {
        const isEnLocale = options?.locale === 'en';
        yield { type: 'status' as const, text: isEnLocale ? 'Planning...' : '规划中...' };
        continue;
      }

      // ── Tool input streaming — extract code in real-time for run_code ──
      if (event.type === 'tool-input-start') {
        const toolName = (event as any).toolName ?? '';
        if (toolName === 'run_code') {
          codeExtractor = { buffer: '', state: 'waiting', escaped: false, sent: 0 };
          const isEnLocale = options?.locale === 'en';
          yield { type: 'status' as const, text: isEnLocale ? 'Generating code...' : '代码生成中...' };
        }
        continue;
      }
      if (event.type === 'tool-input-delta') {
        if (!codeExtractor || codeExtractor.state === 'done') continue;
        const delta = (event as any).delta ?? '';
        codeExtractor.buffer += delta;

        if (codeExtractor.state === 'waiting') {
          // Look for "code": " or "code":" marker (with or without space)
          const match = codeExtractor.buffer.match(/"code"\s*:\s*"/);
          if (!match || match.index === undefined) continue;
          // Found — switch to in_code, start after the opening quote
          codeExtractor.state = 'in_code';
          codeExtractor.sent = match.index + match[0].length;
        }

        if (codeExtractor.state === 'in_code') {
          // Scan new characters for end of JSON string value
          let codeChunk = '';
          let i = codeExtractor.sent;
          while (i < codeExtractor.buffer.length) {
            const ch = codeExtractor.buffer[i];
            if (codeExtractor.escaped) {
              // Unescape JSON: \n → newline, \t → tab, \" → ", \\ → \
              if (ch === 'n') codeChunk += '\n';
              else if (ch === 't') codeChunk += '\t';
              else if (ch === '"') codeChunk += '"';
              else if (ch === '\\') codeChunk += '\\';
              else if (ch === '/') codeChunk += '/';
              else codeChunk += ch;  // fallback: keep as-is
              codeExtractor.escaped = false;
            } else if (ch === '\\') {
              codeExtractor.escaped = true;
            } else if (ch === '"') {
              // End of code value
              codeExtractor.state = 'done';
              break;
            } else {
              codeChunk += ch;
            }
            i++;
          }
          codeExtractor.sent = i;
          if (codeChunk) {
            yield { type: 'code_stream', text: codeChunk };
          }
          if (codeExtractor.state === 'done') {
            yield { type: 'code_stream', text: '', done: true };
          }
        }
        continue;
      }

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
            ? (q ? `Analyzing image: ${q.slice(0, 50)}` : 'Analyzing image')
            : (q ? `分析图片：${q.slice(0, 40)}` : '分析图片') };
        } else if (event.toolName === 'preview_frame') {
          const input = event.input as { frame?: number; timestamp?: number };
          const hint = input.frame !== undefined ? `frame ${input.frame}` : input.timestamp !== undefined ? `${input.timestamp}s` : 'frame 0';
          yield { type: 'status', text: isEnLocale ? `Capturing ${hint}...` : `截帧 ${hint}...` };
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
        // For run_code: truncate code in tool_call event (full code already streamed via tool-input-delta)
        const toolInput = event.input as Record<string, unknown>;
        const isRunCode = event.toolName === 'run_code' && typeof toolInput.code === 'string';
        yield {
          type: 'tool_call',
          tool: event.toolName,
          input: isRunCode
            ? { ...toolInput, code: ((toolInput.code as string)).slice(0, 100) + `... (${(toolInput.code as string).length} chars)` }
            : toolInput,
          ...(toolCallImages ? { images: toolCallImages } : {}),
        };
        // If code wasn't streamed via delta (edge case), send it now
        if (isRunCode && (!codeExtractor || codeExtractor.state === 'waiting')) {
          const code = toolInput.code as string;
          const CHUNK = 500;
          for (let i = 0; i < code.length; i += CHUNK) {
            yield { type: 'code_stream', text: code.slice(i, i + CHUNK) };
          }
          yield { type: 'code_stream', text: '', done: true };
        }
        codeExtractor = null; // reset for next tool call
        continue;
      }

      // ── Tool result — flush generated images + animation task ───────────────
      if (event.type === 'tool-result') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (event as any).toolName as string | undefined;
        const toolDuration = toolCallStartTime ? ((Date.now() - toolCallStartTime) / 1000).toFixed(1) : '?';
        console.log(`⏱️ [agent] tool-result "${toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (tool took ${toolDuration}s)`);
        // Reset status after tool completes so stale status doesn't linger during thinking
        const isEnLocale = options?.locale === 'en';
        yield { type: 'status', text: isEnLocale ? 'Thinking...' : 'Agent 正在思考...' };

        // Emit image_analyzed event so frontend can save the description
        if (toolName === 'analyze_image') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const analyzeInput = (event as any).input as { image_index?: number } | undefined;
          const analyzedIdx = analyzeInput?.image_index ?? (ctx.currentSnapshotIndex + 1);
          yield { type: 'image_analyzed', imageIndex: analyzedIdx };
        }

        // Emit preview_frame_captured so frontend shows the screenshot in CUI
        if (toolName === 'preview_frame') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolOutput = (event as any).output as { workspaceUrl?: string } | undefined;
          const wsUrl = toolOutput?.workspaceUrl;
          if (wsUrl) {
            yield { type: 'preview_frame_captured' as const, workspaceUrl: wsUrl };
          }
        }

        // run_code / write_file output handling — emit design SSE with published flag
        if (toolName === 'run_code' || toolName === 'write_file') {
          // Design output stored in ctx.__pendingDesign → emit as SSE event
          const pendingDesign = (ctx as any).__pendingDesign;
          if (pendingDesign) {
            const published = (ctx as any).__pendingDesignPublished ?? false;
            // Get preview URL from latest draft (if available)
            const drafts = (ctx as any).__runCodeDrafts as { previewUrl?: string }[] | undefined;
            const previewUrl = drafts?.[drafts.length - 1]?.previewUrl || undefined;
            console.log(`🎨 [agent] emitting render SSE (published=${published}): ${pendingDesign.width}x${pendingDesign.height}, code ${pendingDesign.code?.length} chars${previewUrl ? ', preview: ' + previewUrl.slice(-40) : ''}`);
            yield { type: 'render', code: pendingDesign.code, width: pendingDesign.width, height: pendingDesign.height, props: pendingDesign.props, animation: pendingDesign.animation, editables: pendingDesign.editables, published, previewUrl };
            (ctx as any).__pendingDesign = null;
            (ctx as any).__pendingDesignPublished = undefined;
          } else if (toolName === 'run_code') {
            console.log(`🔍 [agent] run_code result: no __pendingDesign found`);
          }
          // Image output (from toModelOutput won't have base64Data here, but pushImage in execute already handled it)
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
        if ((ctx as any).musicTaskId) {
          yield { type: 'music_task', taskId: (ctx as any).musicTaskId };
          (ctx as any).musicTaskId = undefined;
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
