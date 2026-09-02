import { streamText } from 'ai';
import type { ModelMessage } from 'ai';
import type { ModelId } from './models/types';
import agentPrompt from './prompts/agent.md';
import type { VideoModel } from '@/types';
import type { AgentPerf } from './agent-perf';
import { createTextDeltaState, normalizeTextDelta } from './agent-text-delta';
import { normalizeAgentErrorMessage } from './agent-error';
import { compositionPartsPrefix } from './composition-parts';
import {
  resolveCodexSubscriptionFallbackProvider,
  type AgentModelProvider,
  type AgentModelPreference,
} from './agent-models';
import {
  createAgentModelRuntime,
  getAgentProviderOptions,
  sumOpenRouterProviderCost,
} from './agent-model-runtime';
import {
  classifyModelTermination,
  describeModelStreamError,
  shouldStopAfterTerminalToolFailure,
} from './agent-terminal';
import {
  isCodexSubscriptionTerminalFailure,
  isGrokSubscriptionTerminalFailure,
  isRetryableProviderOutage,
  type DurableExecutionRef,
} from './agent-execution';
import { buildDurableCompositionGuidance } from './studio-composition-guidance';
import {
  getReplyLanguageInstruction,
  normalizeLocale,
  translate,
} from './locales';
import { getSkillLaunchSystemDirective, type SkillLaunchContext } from './skill-launch-context';
import { buildAgentOutputLanguageDirective } from './agent-response-policy';
import {
  buildNativeVisionUserContent,
  type NativeVisionImageInput,
} from './agent-image-analysis';
import * as workspace from './workspace';
import {
  createTools,
  formatGeneratedAudioForCui,
  getStudioRunCheckpoint,
  logToolSizes,
  type AgentContext,
  type AgentStreamEvent,
  type AudioAttachment,
  type StreamedCodeCheckpoint,
} from './agent-tools';
import {
  wrapDurableIdempotentTools,
  wrapDurableInputAwareTools,
} from './agent-tool-guards';
export type { AgentStreamEvent } from './agent-tools';

// ---------------------------------------------------------------------------
// System prompt (bundled via webpack asset/source)
// ---------------------------------------------------------------------------

function getAgentSystemPrompt(): string {
  return agentPrompt;
}

function* flushPendingImageSnapshots(ctx: AgentContext): Generator<AgentStreamEvent> {
  if (!ctx.pendingImageSnapshots?.length) return;
  for (const pending of ctx.pendingImageSnapshots) {
    yield {
      type: 'image',
      image: pending.imageUrl,
      imageUrl: pending.imageUrl,
      snapshotId: pending.snapshotId,
      description: pending.description,
    };
  }
  ctx.pendingImageSnapshots = undefined;
}

function generatedImageMetadata(ctx: AgentContext, image: string): import('@/types').PhotoMetadata | undefined {
  if (ctx.lastImageBackground !== 'transparent') return undefined;
  const mime = image.match(/^data:(image\/[^;]+);/i)?.[1] || 'image/png';
  return {
    imageMimeType: mime,
    hasAlpha: true,
    generationBackground: 'transparent',
  };
}

/** Rough token estimate — 1 token ≈ 4 chars for English, ~1.5-2 for CJK. Use 3.5 as middle ground. */
function estTokens(chars: number): number {
  return Math.round(chars / 3.5);
}

/** Build system prompt with lightweight skill manifest (not full templates) */

async function buildSystemPrompt(supabase?: any, userId?: string, projectId?: string): Promise<string> {
  const base = getAgentSystemPrompt();
  const manifest = await workspace.getSkillManifest(supabase, userId);
  const projectPath = projectId ? `${projectId}/` : '';
  const workspaceSection = `

## Workspace

You have a persistent workspace for skills and files.

Tools: \`list_files\`, \`read_file\`, \`write_code_file\`, \`write_file\`, \`delete_file\`, \`run_code\`, \`publish_draft\`

### File organization
- **User-level** (shared across projects): \`skills/\`, \`memory/\`
- **Project-level** (current project): \`${projectPath}code/\`${projectId ? ` — save composition/code files here` : ''}
- **skills/{name}/SKILL.md** — Create reusable skills here. Read \`skills/SKILL_README.md\` for the format.

### run_code
Execute JavaScript in two modes:
- \`runtime: "composition"\` for Remotion/editable composition drafts, animated templates, overlays, and sharp utilities. \`runtime: "design"\` is a legacy alias.
- \`runtime: "node"\` for real file-level MP4 work with FFmpeg/FFprobe: split, exact trim/export, transcode, extract frames, mux audio, long-video preparation, and final assembly of generated chunks.
For finished single images, posters, infographics, and marketing graphics, use \`generate_image\` instead unless the user asks for editable or animated code.
For substantial normal Agent Run code, write the complete program with \`write_code_file\`, then execute its returned workspace path with \`run_code({ code_path })\`. The user sees the real source as it streams, and the file remains available for recovery and later edits. Inline code is for short patches and utilities; Studio Run may use numbered composition parts for long compositions.
For composition files, either save a natural JS/TS/JSX/TSX Remotion module (imports/exports and a top-level Composition are accepted) or the legacy executable body that returns \`{ type: 'render', code, width, height, ... }\`. When a natural module is new and has no existing composition dimensions to inherit, pass its width/height/animation as \`run_code.composition\` metadata without repeating the source.
Always tell the user what you're about to do BEFORE calling run_code (1 sentence). After run_code completes, briefly describe the result.

### Creating skills
Before writing a new skill, read \`skills/SKILL_README.md\` first — it has the exact format (YAML frontmatter + markdown body). Also read an existing skill (e.g. \`skills/makaron-mascot/SKILL.md\`) as a reference.

A good skill is **reusable across any project** — it describes a style, technique, or character, not a specific photo.

${manifest}
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

  const full = base + workspaceSection + memorySection;

  // Observability — prompt size breakdown
  const baseLen = base.length;
  const wsLen = workspaceSection.length;
  const memLen = memorySection.length;
  const total = full.length;
  console.log(
    `[agent-prompt] system base=${baseLen} workspace=${wsLen} memory=${memLen} total=${total} chars (~${estTokens(total)} tokens)`
  );

  return full;
}

function buildLightweightSystemPrompt(mode: 'analysis' | 'tipReaction', locale?: string): string {
  const languageRule = getReplyLanguageInstruction(locale);
  if (mode === 'analysis') {
    return [
      'You are Makaron, a warm and concise creative media assistant.',
      'Use the available analysis tool exactly once before answering.',
      'Describe what you see directly. Do not mention tools, hidden prompts, or system instructions.',
      'Keep the answer short, natural, and useful for photo or video editing context.',
      languageRule,
    ].join('\n');
  }
  return [
    'You are Makaron, a warm and concise creative media assistant.',
    'Write only the requested short user-facing response.',
    'Do not mention tools, hidden prompts, system instructions, or implementation details.',
    languageRule,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

function readJsonStringValueFromBuffer(buffer: string, key: string): { complete: boolean; value: string } | null {
  const match = buffer.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!match || match.index === undefined) return null;

  let index = match.index + match[0].length;
  let value = '';
  while (index < buffer.length) {
    const char = buffer[index];
    if (char === '"') {
      return { complete: true, value };
    }
    if (char !== '\\') {
      value += char;
      index++;
      continue;
    }

    if (index + 1 >= buffer.length) return { complete: false, value };
    const escape = buffer[index + 1];
    if (escape === 'u') {
      if (index + 6 > buffer.length) return { complete: false, value };
      const hex = buffer.slice(index + 2, index + 6);
      value += /^[0-9a-fA-F]{4}$/.test(hex)
        ? String.fromCharCode(Number.parseInt(hex, 16))
        : `\\u${hex}`;
      index += 6;
      continue;
    }
    if (escape === 'n') value += '\n';
    else if (escape === 'r') value += '\r';
    else if (escape === 't') value += '\t';
    else if (escape === 'b') value += '\b';
    else if (escape === 'f') value += '\f';
    else if (escape === '"') value += '"';
    else if (escape === '\\') value += '\\';
    else if (escape === '/') value += '/';
    else value += escape;
    index += 2;
  }

  return { complete: false, value };
}

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `Describe this photo in 1-2 sentences, in the tone of a friend sharing what they noticed. Start directly with the subject. Do not use any preamble such as "Let me take a look".`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `The edit is complete. In one sentence, directly describe the edited image's overall effect and mood. Acknowledge that this is the result after editing, without any preamble.`;

// Used for video upload auto-analysis
const ANALYSIS_PROMPT_VIDEO_TEMPLATE = (mediaIndex: number) =>
  `[System: User just uploaded a video at <<<media_${mediaIndex}>>>. Analyze it and describe the content.]\nDescribe this video in 2-3 sentences — duration, key subjects/actions, mood. Be conversational. No preamble.`;

export interface RunMakaronAgentOptions {
  analysisOnly?: boolean;
  analysisContext?: 'initial' | 'post-edit';
  isVideoAnalysis?: boolean;
  tipReactionOnly?: boolean;
  disableToolCalls?: boolean;
  referenceImages?: string[];
  animationImageUrls?: string[];
  animationImages?: string[];
  /** Still images to send with the current user text in one multimodal request. */
  nativeVisionImages?: NativeVisionImageInput[];
  locale?: string;
  preferredModel?: ModelId;
  agentModel?: AgentModelPreference;
  agentProvider?: AgentModelProvider;
  videoModel?: string;
  videoResolution?: import('@/types').VideoResolution;
  videoAuto?: boolean;
  skillLaunchContext?: SkillLaunchContext;
  audioAttachments?: AudioAttachment[];
  snapshotImages?: string[];
  explicitMediaIndices?: number[];
  currentSnapshotIndex?: number;
  isNsfw?: boolean;
  supabase?: any;
  userId?: string;
  codexSubscriptionAllowed?: boolean;
  currentDesign?: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string } };
  currentDesignPath?: string;
  history?: ModelMessage[];
  timelineVersion?: number;
  perf?: AgentPerf;
  abortSignal?: AbortSignal;
  execution?: DurableExecutionRef;
  /** Workflow context for model guidance only. It never controls Agent termination or retries. */
  studioWorkflowStage?: string;
  agentRunId?: string;
  attemptBudgetMs?: number;
  maxSteps?: number;
  contextCompactAtTokens?: number;
  historyBoundary?: string;
}

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,

  options?: RunMakaronAgentOptions,
): AsyncGenerator<AgentStreamEvent> {
  const perf = options?.perf;
  const runtime = createAgentModelRuntime(
    options?.agentModel,
    projectId,
    options?.agentProvider,
    options?.userId,
    options?.codexSubscriptionAllowed,
  );
  const ctx: AgentContext = {
    currentImage,
    referenceImages: options?.referenceImages,
    projectId,
    generatedImages: [],
    animationImageUrls: options?.animationImageUrls,
    videoModel: options?.videoModel as VideoModel | undefined,
    videoResolution: options?.videoResolution,
    videoAuto: options?.videoAuto,
    audioAttachments: options?.audioAttachments,
    preferredModel: options?.preferredModel,
    snapshotImages: (options?.snapshotImages ?? [currentImage]).filter(img => img.length > 0),
    explicitMediaIndices: options?.explicitMediaIndices ?? [],
    currentSnapshotIndex: options?.currentSnapshotIndex ?? 0,
    isNsfw: options?.isNsfw,
    supabase: options?.supabase,
    userId: options?.userId,
    timelineVersion: options?.timelineVersion,
    currentDesignPath: options?.currentDesignPath,
    execution: options?.execution,
    agentRunId: options?.agentRunId || options?.execution?.runId,
  };
  if (options?.currentDesign) {
    (ctx as any).__lastDesignPayload = { ...options.currentDesign };
  }

  const allTools = wrapDurableInputAwareTools(
    wrapDurableIdempotentTools(
      createTools(ctx, runtime, options?.locale, Boolean(options?.execution)),
      ctx,
    ),
    ctx,
  );
  const durableContinuation = Boolean(options?.execution && options.execution.attemptNo > 1);
  if (!durableContinuation) delete (allTools as Record<string, unknown>).execution_checkpoint;
  perf?.mark('agent_tools_created', { toolCount: Object.keys(allTools).length });
  let imagesSent = 0;
  let stepCount = 0;
  let toolCallStartTime = 0;
  let toolCallName = '';
  let activeToolCallId: string | undefined;
  const agentStartTime = Date.now();

  const analysisOnly = options?.analysisOnly ?? false;
  const isVideoAnalysis = options?.isVideoAnalysis ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const configuredMaxSteps = Number.parseInt(process.env.AGENT_MAX_STEPS || '', 10);
  const normalMaxSteps = typeof options?.maxSteps === 'number' && Number.isFinite(options.maxSteps)
    ? Math.min(120, Math.max(1, Math.floor(options.maxSteps)))
    : Number.isFinite(configuredMaxSteps)
      ? Math.min(120, Math.max(30, configuredMaxSteps))
      : 60;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : normalMaxSteps;
  const videoMediaIndex = isVideoAnalysis ? (options?.currentSnapshotIndex ?? 0) + 1 : 0;
  const analysisPrompt = isVideoAnalysis ? ANALYSIS_PROMPT_VIDEO_TEMPLATE(videoMediaIndex)
    : options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL;

  const nativeImageAnalysis = analysisOnly
    && !isVideoAnalysis
    && runtime.spec.supportsImageInput
    && Boolean(currentImage);

  // Determine which tools to expose
  // tipReactionOnly: no tools (text-only response)
  // analysisOnly: multimodal Agents see the image in their first request;
  // text-only image Agents and all video analysis retain their analyzer tool.
  // normal chat / animation: all tools including workspace (agent.md controls behavior)
  const tools = tipReactionOnly ? undefined : analysisOnly
    ? nativeImageAnalysis
      ? undefined
      : (isVideoAnalysis ? { analyze_video: allTools.analyze_video } : { analyze_image: allTools.analyze_image })
    : allTools;

  // Build user message content. Visual Agents receive the relevant still images
  // in the same first request as the user's text. DeepSeek remains text-only and
  // reaches images through analyze_image's Gemini fallback.
  const animImages = options?.animationImages;
  const directVisionImages: NativeVisionImageInput[] = nativeImageAnalysis
    ? [{ source: currentImage }]
    : animImages?.length
      ? animImages.map((source) => ({ source }))
      : (options?.nativeVisionImages ?? []);

  let userContent: any;
  if (directVisionImages.length && runtime.spec.supportsImageInput && !tipReactionOnly) {
    userContent = buildNativeVisionUserContent(
      analysisOnly ? analysisPrompt : prompt,
      directVisionImages,
    );
  } else {
    // Inject only the pointer/metadata, never full composition code. The agent
    // must pass code_path explicitly in run_code patch mode for persisted compositions.
    const promptHasCompositionPointer = typeof prompt === 'string'
      && (prompt.includes('[Current Composition]') || prompt.includes('[Current composition pointer]'));
    const designInjection = options?.currentDesignPath && !promptHasCompositionPointer
      ? `[Current composition pointer]\npath: ${options.currentDesignPath}${options.currentDesign ? `\nwidth: ${options.currentDesign.width}\nheight: ${options.currentDesign.height}${options.currentDesign.animation ? `\nanimation: ${options.currentDesign.animation.durationInSeconds}s @ ${options.currentDesign.animation.fps}fps` : ''}` : ''}\nTo modify this existing composition, call run_code with a JS return value like { type: 'patch', code_path: '${options.currentDesignPath}', edits: [...] } or { type: 'patch', code_path: '${options.currentDesignPath}', props: {...} } and runtime: "composition". Use props-only patches for text/data changes. Do not render from scratch unless the user asks for a new composition.\n\n`
      : '';
    const textOnlyVisionNote = animImages?.length && !runtime.spec.supportsImageInput
      ? '\n\n[Selected Agent model is text-only. Use analyze_image on the relevant Media Index entries before making image-dependent decisions.]'
      : '';
    userContent = analysisOnly ? analysisPrompt : (designInjection + prompt + textOnlyVisionNote);
  }

  // Build system prompt. Lightweight modes must stay small: they power
  // auto-analysis/reactions where first visible text matters more than the
  // full workspace skill surface.
  const endSystemPrompt = perf?.span('build_system_prompt', {
    projectId,
    injectedSkillBodies: 0,
    mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
  });
  const baseSystemPrompt = (analysisOnly || tipReactionOnly)
    ? buildLightweightSystemPrompt(analysisOnly ? 'analysis' : 'tipReaction', options?.locale)
    : await buildSystemPrompt(options?.supabase, options?.userId, projectId);
  const continuationExecution = durableContinuation ? options?.execution : undefined;
  const durableExecutionDirective = continuationExecution
    ? `\n\n## Durable execution contract\nThis is attempt ${continuationExecution.attemptNo} of Agent Run ${continuationExecution.runId}. A later attempt may continue in a fresh model context only after a technical interruption, provider failure, context handoff, or newer user input. Preserve decisions and durable artifact pointers with execution_checkpoint after meaningful progress and before a long, risky generation step. Do not repeat expensive side effects whose tool result is already present. A Studio Run is only a persisted workflow that you follow with studio_run; its stage never decides whether this Agent Run ends or retries. Finish normally when you have completed the current user-facing turn, even if the workflow remains at Review or another stage. If this attempt advances the workflow into Composition, switch to numbered composition parts immediately and never begin a monolithic run_code payload. A newer queued user instruction has precedence over an older delivery target.`
    : '';
  const durableCompositionDirective = continuationExecution && options?.studioWorkflowStage === 'composition'
    ? `\n\n## Durable Composition workspace\nKeep the full original Composition and Director creative standard, but do not emit a monolithic run_code composition payload. Long tool-input streams can reset before the call closes. Author the final Remotion source as numbered files under ${projectId}/drafts/composition-parts, one cohesive part per model step with write_file. Include compositionMetadata with the first part so dimensions, props, and animation are durable; omit editables because the assembled composition infers its Manifest automatically. Only repeat metadata when it changes. Keep each part under the 12000-character transport limit, wait for its tool result, and create as many parts as the approved content needs. Parts around 3000-8000 characters are preferred, but never compress creative detail merely to hit that range. Rewriting the same numbered path is safe after recovery. Do not use import/export; the files are concatenated into one scope with no aggregate source-size or part-count limit. Never shorten approved narration, subtitles, scenes, animation, or visual detail to reduce source size. Every successful write automatically assembles, validates, and autosaves the workspace. Continue until write_file reports compositionWorkspace.status="ready", then preview or patch its designPath directly. Do not spend another model turn calling run_code merely to assemble the directory. This changes only persistence and transport; it must not simplify the approved story, audio, visual direction, or ending.`
    : '';
  const durableCompositionGuidance = continuationExecution && options?.studioWorkflowStage === 'composition'
    ? buildDurableCompositionGuidance()
    : '';
  const executionSystemPrompt = `${baseSystemPrompt}${durableExecutionDirective}${durableCompositionDirective}${durableCompositionGuidance}`;
  const languageDirective = buildAgentOutputLanguageDirective(options?.locale);
  const skillLaunchDirective = getSkillLaunchSystemDirective(options?.skillLaunchContext);
  const systemPrompt = `${executionSystemPrompt}${languageDirective}${skillLaunchDirective}`;
  const responseLocale = normalizeLocale(options?.locale, 'en');
  endSystemPrompt?.({ systemChars: systemPrompt.length });

  // Observability — per-request summary
  const toolsChars = tools ? logToolSizes(tools as Record<string, unknown>) : 0;
  const userContentChars = typeof userContent === 'string'
    ? userContent.length
    : Array.isArray(userContent)
      ? userContent.reduce((s: number, p: { type?: string; text?: string }) => s + (p?.type === 'text' ? (p.text?.length ?? 0) : 0), 0)
      : 0;
  const userImagesCount = Array.isArray(userContent)
    ? userContent.filter((p: { type?: string; mediaType?: string }) => (
        p?.type === 'image' || (p?.type === 'file' && p.mediaType?.startsWith('image/'))
      )).length
    : 0;
  // analysis / tipReaction modes intentionally skip history to keep
  // the request single-turn (matches prior behavior). Normal chat and video
  // requests send it so read_file/tool results can be reused cross-turn.
  const sendHistory = !analysisOnly && !tipReactionOnly;
  const history = sendHistory ? (options?.history ?? []) : [];
  console.log(
    `[agent-req] systemChars=${systemPrompt.length} toolsChars=${toolsChars} userChars=${userContentChars} images=${userImagesCount} historyTurns=${history.length} mode=${tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal'}`
  );
  perf?.mark('agent_request_ready', {
    systemChars: systemPrompt.length,
    toolsChars,
    userChars: userContentChars,
    userImages: userImagesCount,
    historyTurns: history.length,
    mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
    agentModel: runtime.spec.id,
    provider: runtime.spec.provider,
  });

  // Optional full-request dump for offline diffing
  if (process.env.AGENT_DEBUG_DUMP === '1') {
    try {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const ts = Date.now();
      const dumpPath = path.join(os.tmpdir(), `agent-req-${ts}.json`);
      const toolsDump = tools
        ? Object.fromEntries(Object.entries(tools).map(([k, v]: [string, unknown]) => [k, { description: (v as { description?: string })?.description || '' }]))
        : {};
      const userContentDump = typeof userContent === 'string'
        ? userContent
        : Array.isArray(userContent)
          ? userContent.map((p: { type?: string; text?: string; mediaType?: string }) => (
              p?.type === 'image' || (p?.type === 'file' && p.mediaType?.startsWith('image/'))
                ? { type: p.type, mediaType: p.mediaType, omitted: true }
                : p
            ))
          : userContent;
      await fs.writeFile(dumpPath, JSON.stringify({
        ts, mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
        systemPrompt, tools: toolsDump, history, userContent: userContentDump,
      }, null, 2));
      console.log(`[agent-req] dumped → ${dumpPath}`);
    } catch (e) { console.log(`[agent-req] dump failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  let firstContentAt = 0;
  let firstVisibleTextAt = 0;

  const msgs: ModelMessage[] = [
    ...history,
    { role: 'user', content: userContent } as ModelMessage,
  ];

  try {
    const configuredIdleTimeout = Number(process.env.AGENT_MODEL_IDLE_TIMEOUT_MS || 300_000);
    const streamIdleTimeoutMs = Number.isFinite(configuredIdleTimeout)
      ? Math.max(30_000, Math.min(configuredIdleTimeout, 600_000))
      : 300_000;
    const attemptResults: any[] = [];
    let billedNoCacheTokens = 0;
    let billedCacheReadTokens = 0;
    let billedCacheWriteTokens = 0;
    let billedOutputTokens = 0;
    let cacheWriteTelemetryComplete = true;
    const billedStepMetadata: Array<{ providerMetadata?: Record<string, unknown> }> = [];
    let usageEmitted = false;
    const compactionBlocks = new Map<string, string>();
    const pendingCompactionSummaries: string[] = [];
    let attemptMessages: ModelMessage[] = msgs;
    let result: any = null;
    let recoveryAttempt = 0;
    let recoveryTextOnly = false;
    const recoveryBlockedTools = new Set<string>();
    const nonRepeatableTools = new Set([
      'generate_image',
      'generate_animation',
      'transcribe_audio',
      'rotate_camera',
      'delete_file',
      'generate_audio',
      'prepare_visual_asset',
    ]);

    const recordStepUsage = (event: any) => {
      const usage = event?.usage as {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
        inputTokenDetails?: {
          noCacheTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      } | undefined;
      if (!usage) return;
      const details = usage.inputTokenDetails;
      const cacheRead = details?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
      const cacheWrite = details?.cacheWriteTokens ?? 0;
      if (details?.cacheWriteTokens == null) cacheWriteTelemetryComplete = false;
      const noCache = details?.noCacheTokens
        ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
      billedNoCacheTokens += noCache;
      billedCacheReadTokens += cacheRead;
      billedCacheWriteTokens += cacheWrite;
      billedOutputTokens += usage.outputTokens ?? 0;
      billedStepMetadata.push({ providerMetadata: event.providerMetadata });
    };

    const buildUsageEvent = (): Extract<AgentStreamEvent, { type: 'usage' }> | null => {
      if (usageEmitted || billedStepMetadata.length === 0) return null;
      usageEmitted = true;
      const modelId = runtime.spec.billingModelId;
      const totalInput = billedNoCacheTokens + billedCacheReadTokens + billedCacheWriteTokens;
      const hitRate = totalInput > 0
        ? ((billedCacheReadTokens / totalInput) * 100).toFixed(1)
        : '0';
      const providerCostUsd = sumOpenRouterProviderCost(runtime, billedStepMetadata);
      const cacheWriteLog = cacheWriteTelemetryComplete
        ? String(billedCacheWriteTokens)
        : 'unreported';
      console.log(
        `[agent-usage] totalInput=${totalInput} (noCache=${billedNoCacheTokens} cacheRead=${billedCacheReadTokens} cacheWrite=${cacheWriteLog}) output=${billedOutputTokens} hitRate=${hitRate}% model=${modelId} provider=${runtime.spec.provider}${providerCostUsd != null ? ` providerCostUsd=${providerCostUsd.toFixed(6)}` : ''}`
      );
      return {
        type: 'usage',
        inputTokens: billedNoCacheTokens,
        outputTokens: billedOutputTokens,
        cacheReadTokens: billedCacheReadTokens,
        cacheWriteTokens: billedCacheWriteTokens,
        cacheWriteTelemetryComplete,
        providerCostUsd,
        model: modelId,
      };
    };

    while (true) {
      let sawFinish = false;
      let finishReason: string | undefined;
      let rawFinishReason: string | undefined;
      let finalStepTextChars = 0;
      let finalStepToolCalls = 0;
      let finalStepDeliveredArtifact = false;
      let attemptDeliveredArtifact = false;
      const attemptCommittedTools = new Set<string>();
      let nonRetryableToolFailure: { message: string; code?: string } | undefined;
      let streamError: unknown;
      let lastTool = '';

      const endStreamInit = perf?.span('model_stream_init', { projectId, recoveryAttempt });
      const invocationBudgetMs = typeof options?.attemptBudgetMs === 'number' && Number.isFinite(options.attemptBudgetMs)
        ? Math.max(60_000, Math.min(options.attemptBudgetMs, 1_500_000))
        : 1_500_000;
      const invocationDeadline = agentStartTime + invocationBudgetMs;
      let attemptBudgetReached = false;
      let stepBudgetReached = false;
      const recoveryActiveTools = tools && recoveryBlockedTools.size > 0
        ? Object.keys(tools).filter((toolName) => !recoveryBlockedTools.has(toolName))
        : undefined;
      result = (streamText as any)({
      model: runtime.model,
      system: [{
        role: 'system',
        content: systemPrompt,
      }],
      messages: attemptMessages,
      ...(tools ? { tools } : {}),
      ...((recoveryTextOnly || options?.disableToolCalls) && tools
        ? { toolChoice: 'none' as const }
        : {}),
      ...(analysisOnly && tools
        ? { activeTools: [isVideoAnalysis ? 'analyze_video' : 'analyze_image'] }
        : recoveryActiveTools
          ? { activeTools: recoveryActiveTools }
          : {}),
      stopWhen: [
        ({ steps }: { steps: unknown[] }) => {
          if (steps.length < maxSteps) return false;
          stepBudgetReached = true;
          return true;
        },
        ({ steps }: { steps: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown }> }> }) => {
          return shouldStopAfterTerminalToolFailure({
            toolResults: steps.at(-1)?.toolResults,
          });
        },
        // The attempt budget is a handoff boundary, not a kill timer. AI SDK
        // evaluates stop conditions only after a complete model/tool step, so
        // active tool arguments and tool results stay paired and recoverable.
        () => {
          if (!options?.execution || Date.now() < invocationDeadline) return false;
          attemptBudgetReached = true;
          return true;
        },
      ],
      prepareStep: ({ messages }: { messages: ModelMessage[] }) => ({
        messages: runtime.normalizeMessages(messages),
      }),
      onStepFinish: () => { stepCount++; },
      // Durable execution owns retry, failover, and checkpoint semantics. Letting
      // the SDK retry internally turns one timed-out model call into several
      // invisible calls before the runner can switch providers.
      ...(options?.execution ? { maxRetries: 0 } : {}),
      // A long coding step may stream valid source for several minutes. Only
      // an actually idle model stream is timed out. Tool implementations own
      // their domain-specific timeouts; the attempt budget drains at a safe
      // step boundary above instead of aborting active work.
      timeout: {
        chunkMs: streamIdleTimeoutMs,
      },
      ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      providerOptions: getAgentProviderOptions(runtime, {
        compactAtTokens: options?.contextCompactAtTokens,
      }),
      });
      attemptResults.push(result);
      endStreamInit?.();

    // Stream real source from code-bearing tool inputs and checkpoint it before
    // the tool call closes, so a transport reset cannot erase minutes of work.
    let codeExtractor: {
      toolName: 'run_code' | 'write_code_file' | 'write_file';
      valueKey: 'code' | 'content';
      toolCallId: string;
      targetPath?: string;
      buffer: string;
      state: 'waiting' | 'in_code' | 'done';
      decoded: string;
      lastSavedChars: number;
      lastProgressChars: number;
      descriptionSent: number;
      codeStreamStarted: boolean;
    } | null = null;
    let completedCodeTargetPath: string | undefined;
    const persistStreamedCodeCheckpoint = async (force = false) => {
      if (!codeExtractor || !ctx.supabase || !ctx.userId) return;
      const unsavedChars = codeExtractor.decoded.length - codeExtractor.lastSavedChars;
      if (unsavedChars <= 0 || (!force && unsavedChars < 1_000)) return;
      const targetSlug = `${codeExtractor.targetPath?.split('/').at(-1) || 'inline'}-${codeExtractor.toolCallId}`
        .replace(/[^a-zA-Z0-9.-]+/g, '-')
        .slice(0, 80);
      const partialPath = `${ctx.projectId}/drafts/streamed-${codeExtractor.toolName}-${targetSlug}.partial.js`;
      const saved = await workspace.writeFile(
        partialPath,
        codeExtractor.decoded,
        ctx.supabase,
        ctx.userId,
        'text/javascript',
      );
      if (saved.success) {
        codeExtractor.lastSavedChars = codeExtractor.decoded.length;
        (ctx as any).__streamedCodeCheckpoint = {
          streamedCodePath: partialPath,
          streamedCodeChars: codeExtractor.decoded.length,
          ...(codeExtractor.targetPath ? { streamedCodeTargetPath: codeExtractor.targetPath } : {}),
        } satisfies StreamedCodeCheckpoint;
      }
    };
    const textDeltaState = createTextDeltaState();

      try {
        for await (const event of result.fullStream) {
      if (event.type === 'start-step') {
        finalStepTextChars = 0;
        finalStepToolCalls = 0;
        finalStepDeliveredArtifact = false;
        if (stepCount > 0) yield { type: 'new_turn' };
        continue;
      }
      if (event.type === 'finish-step') {
        recordStepUsage(event);
        finishReason = (event as any).finishReason;
        rawFinishReason = (event as any).rawFinishReason;
        const usage = (event as any).usage as { inputTokens?: number } | undefined;
        const contextManagement = (event as any).providerMetadata?.anthropic?.contextManagement as {
          appliedEdits?: Array<Record<string, unknown>>;
        } | undefined;
        const appliedEdits = contextManagement?.appliedEdits ?? [];
        if (pendingCompactionSummaries.length || appliedEdits.length) {
          const summary = pendingCompactionSummaries.splice(0).join('\n\n');
          if (summary) {
            (ctx as any).__providerCompaction = {
              summary,
              appliedEdits,
              inputTokens: usage?.inputTokens,
            };
            yield {
              type: 'context_compaction',
              provider: 'anthropic',
              modelId: runtime.spec.id,
              compactedThrough: options?.historyBoundary,
              summary,
              appliedEdits,
              inputTokens: usage?.inputTokens,
            };
          }
        }
        continue;
      }
      if (event.type === 'finish') {
        sawFinish = true;
        finishReason = (event as any).finishReason;
        rawFinishReason = (event as any).rawFinishReason;
        continue;
      }
      if (event.type === 'abort') {
        streamError = new Error((event as any).reason || 'Model stream aborted');
        continue;
      }
      // ── TTFB — log first stream event that indicates model is producing output ──
      if (!firstContentAt && (event.type === 'reasoning-start' || event.type === 'reasoning-delta' || event.type === 'text-delta' || event.type === 'tool-input-start')) {
        firstContentAt = Date.now();
        console.log(`[agent-ttfb] ${firstContentAt - agentStartTime}ms (first ${event.type})`);
        perf?.mark('model_first_output', { eventType: event.type, ttfbMs: firstContentAt - agentStartTime });
      }
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
        yield { type: 'status' as const, text: translate(responseLocale, 'agent.status.planning') };
        continue;
      }

      if (event.type === 'custom' && (event as any).kind === 'openai.compaction') {
        const providerKey = runtime.spec.provider === 'azure-openai' ? 'azure' : 'openai';
        const metadata = (event as any).providerMetadata?.[providerKey] as {
          itemId?: string;
          encryptedContent?: string;
        } | undefined;
        if (metadata?.itemId && metadata.encryptedContent) {
          yield {
            type: 'context_compaction',
            provider: 'openai',
            modelId: runtime.spec.id,
            compactedThrough: options?.historyBoundary,
            item: {
              kind: 'openai.compaction',
              providerKey,
              itemId: metadata.itemId,
              encryptedContent: metadata.encryptedContent,
            },
          };
        }
        continue;
      }

      if (event.type === 'text-start') {
        const anthropic = (event as any).providerMetadata?.anthropic as { type?: string } | undefined;
        if (anthropic?.type === 'compaction') {
          compactionBlocks.set(String((event as any).id ?? 'compaction'), '');
        }
        continue;
      }

      if (event.type === 'text-end') {
        const id = String((event as any).id ?? 'compaction');
        const summary = compactionBlocks.get(id);
        if (summary !== undefined) {
          if (summary.trim()) pendingCompactionSummaries.push(summary);
          compactionBlocks.delete(id);
        }
        continue;
      }

      // ── Tool input streaming — expose and checkpoint real source code ──
      if (event.type === 'tool-input-start') {
        const toolName = (event as any).toolName ?? '';
        if (toolName) lastTool = toolName;
        if (toolName === 'run_code' || toolName === 'write_code_file' || toolName === 'write_file') {
          codeExtractor = {
            toolName,
            valueKey: toolName === 'run_code' ? 'code' : 'content',
            toolCallId: String((event as any).toolCallId || crypto.randomUUID()),
            buffer: '',
            state: 'waiting',
            decoded: '',
            lastSavedChars: 0,
            lastProgressChars: 0,
            descriptionSent: 0,
            codeStreamStarted: false,
          };
          if (toolName !== 'write_file') {
            yield { type: 'status' as const, text: translate(responseLocale, 'agent.status.generatingCode') };
          }
        }
        continue;
      }
      if (event.type === 'tool-input-delta') {
        if (!codeExtractor || codeExtractor.state === 'done') continue;
        const delta = (event as any).delta ?? '';
        codeExtractor.buffer += delta;

        if (codeExtractor.toolName === 'write_file' && !codeExtractor.targetPath) {
          const pathValue = readJsonStringValueFromBuffer(codeExtractor.buffer, 'path');
          if (!pathValue?.complete) continue;
          if (!pathValue.value.startsWith(compositionPartsPrefix(ctx.projectId))) {
            codeExtractor = null;
            continue;
          }
          codeExtractor.targetPath = pathValue.value;
          const filename = pathValue.value.split('/').at(-1) || pathValue.value;
          yield {
            type: 'status' as const,
            text: responseLocale.startsWith('zh')
              ? `正在写 ${filename}`
              : `Writing ${filename}`,
          };
        }

        if (codeExtractor.toolName === 'write_code_file' && !codeExtractor.codeStreamStarted) {
          const description = readJsonStringValueFromBuffer(codeExtractor.buffer, 'description');
          const nextDescriptionChunk = description?.value.slice(codeExtractor.descriptionSent) ?? '';
          if (nextDescriptionChunk) {
            const prefix = codeExtractor.descriptionSent === 0 ? '\n\n' : '';
            codeExtractor.descriptionSent = description?.value.length ?? codeExtractor.descriptionSent;
            yield { type: 'content' as const, text: `${prefix}${nextDescriptionChunk}` };
          }
        }

        const streamedValue = readJsonStringValueFromBuffer(codeExtractor.buffer, codeExtractor.valueKey);
        if (!streamedValue) continue;
        codeExtractor.state = streamedValue.complete ? 'done' : 'in_code';
        const codeChunk = streamedValue.value.slice(codeExtractor.decoded.length);
        if (codeChunk) {
          codeExtractor.codeStreamStarted = true;
          codeExtractor.decoded = streamedValue.value;
          yield { type: 'code_stream', text: codeChunk };
          if (
            codeExtractor.toolName === 'write_file'
            && codeExtractor.decoded.length - codeExtractor.lastProgressChars >= 2_000
          ) {
            codeExtractor.lastProgressChars = codeExtractor.decoded.length;
            const filename = codeExtractor.targetPath?.split('/').at(-1) || 'composition source';
            yield {
              type: 'status' as const,
              text: responseLocale.startsWith('zh')
                ? `正在写 ${filename} · ${codeExtractor.decoded.length.toLocaleString()} 字符`
                : `Writing ${filename} · ${codeExtractor.decoded.length.toLocaleString()} chars`,
            };
          }
          await persistStreamedCodeCheckpoint();
        }
        if (codeExtractor.state === 'done') {
          yield { type: 'code_stream', text: '', done: true };
        }
        continue;
      }

      // ── Text delta ──────────────────────────────────────────────────────────
      if (event.type === 'text-delta') {
        const text = normalizeTextDelta(event as { delta?: unknown; textDelta?: unknown; text?: unknown }, textDeltaState);
        const textId = String((event as any).id ?? 'compaction');
        if (compactionBlocks.has(textId)) {
          compactionBlocks.set(textId, `${compactionBlocks.get(textId) || ''}${text}`);
          continue;
        }
        if (text) {
          if (!firstVisibleTextAt) {
            firstVisibleTextAt = Date.now();
            const firstVisibleTextMs = firstVisibleTextAt - agentStartTime;
            console.log(`[agent-first-text] ${firstVisibleTextMs}ms`);
            perf?.mark('model_first_visible_text', { firstVisibleTextMs });
          }
          finalStepTextChars += text.trim().length;
          yield { type: 'content', text };
        }
        continue;
      }

      // ── Tool call ───────────────────────────────────────────────────────────
      if (event.type === 'tool-call') {
        toolCallStartTime = Date.now();
        toolCallName = event.toolName;
        lastTool = event.toolName;
        finalStepToolCalls++;
        activeToolCallId = (event as { toolCallId?: string }).toolCallId || crypto.randomUUID();
        console.log(`⏱️ [agent] tool-call "${event.toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s`);
        perf?.mark('tool_call', {
          tool: event.toolName,
          step: stepCount,
          sinceAgentStartMs: Date.now() - agentStartTime,
        });
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.analyzingImage', q?.slice(0, 50) ?? '') };
        } else if (event.toolName === 'analyze_video') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.analyzingVideo', q?.slice(0, 50) ?? '') };
        } else if (event.toolName === 'transcribe_audio') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.transcribingAudio') };
        } else if (event.toolName === 'list_voiceover_voices') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.choosingVoice') };
        } else if (event.toolName === 'generate_voiceover') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingVoiceover') };
        } else if (event.toolName === 'generate_audio') {
          const kind = (event.input as { kind?: string }).kind;
          yield {
            type: 'status',
            text: translate(
              responseLocale,
              kind === 'voiceover' ? 'agent.status.generatingVoiceover' : 'agent.status.generatingAudio',
            ),
          };
        } else if (event.toolName === 'preview_frame') {
          const input = event.input as { frame?: number; timestamp?: number; frames?: number[]; timestamps?: number[] };
          const batch = input.frames?.length ? input.frames.join(', ') : input.timestamps?.length ? input.timestamps.map(value => `${value}s`).join(', ') : '';
          const hint = batch || (input.frame !== undefined ? `frame ${input.frame}` : input.timestamp !== undefined ? `${input.timestamp}s` : 'frame 0');
          yield { type: 'status', text: translate(responseLocale, 'agent.status.capturingFrame', hint) };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingImage') };
        } else if (event.toolName === 'generate_animation') {
          yield { type: 'status', text: translate(responseLocale, 'status.submittingVideo') };
        } else if (event.toolName === 'list_files') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.browsingWorkspace') };
        } else if (event.toolName === 'read_file') {
          const p = (event.input as { path?: string }).path || '';
          yield { type: 'status', text: translate(responseLocale, 'agent.status.readingFile', p.split('/').pop() ?? '') };
        } else if (event.toolName === 'write_code_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingCode') };
        } else if (event.toolName === 'write_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.saving') };
        } else if (event.toolName === 'delete_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.deleting') };
        } else if (event.toolName === 'run_code') {
          const desc = (event.input as { description?: string }).description;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.runningCode', desc ?? '') };
        } else if (event.toolName === 'rotate_camera') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.rotatingCamera') };
        }
        let toolCallImages: string[] | undefined;
        if (event.toolName === 'generate_image') {
          const inp = event.input as { media_index?: number; reference_media_indices?: number[]; media_refs?: string[] };
          // Resolve the actual edit target (respects media_index; omit = text-to-image)
          let displayTarget: string | undefined;
          if (inp.media_index !== undefined) {
            const idx = inp.media_index - 1;
            if (idx >= 0 && idx < ctx.snapshotImages.length) {
              displayTarget = ctx.snapshotImages[idx];
            }
          } else if (ctx.currentImage && !ctx.snapshotImages.includes(ctx.currentImage)) {
            displayTarget = ctx.currentImage;
          }
          // Resolve reference images from snapshot indices
          const snapshotRefs: string[] = [];
          if (inp.reference_media_indices?.length) {
            for (const refIdx of inp.reference_media_indices) {
              const idx = refIdx - 1;
              if (idx >= 0 && idx < ctx.snapshotImages.length) {
                snapshotRefs.push(ctx.snapshotImages[idx]);
              }
            }
          }
          const extraRefs: string[] = [];
          if (inp.media_refs?.length) extraRefs.push(...inp.media_refs);
          if (displayTarget || extraRefs.length) {
            toolCallImages = [
              ...(displayTarget ? [displayTarget] : []),
              ...(ctx.referenceImages ?? []),
              ...snapshotRefs,
            ];
          }
        }
        // For run_code: keep the real input for persistence/model history, but send a
        // compact display input to the client. Replaying a UI-truncated code string
        // teaches the next model turn to copy "... (N chars)" as executable code.
        const toolInput = event.input as Record<string, unknown>;
        const directComposition = toolInput.composition && typeof toolInput.composition === 'object'
          ? toolInput.composition as Record<string, unknown>
          : undefined;
        const streamedCode = typeof toolInput.code === 'string'
          ? toolInput.code
          : typeof directComposition?.code === 'string'
            ? directComposition.code
            : undefined;
        const isRunCode = event.toolName === 'run_code' && typeof streamedCode === 'string';
        const isWriteCodeFile = event.toolName === 'write_code_file' && typeof toolInput.content === 'string';
        const isCompositionPartWrite = event.toolName === 'write_file'
          && typeof toolInput.path === 'string'
          && toolInput.path.startsWith(compositionPartsPrefix(ctx.projectId))
          && typeof toolInput.content === 'string';
        if (
          isWriteCodeFile
          && (!codeExtractor || codeExtractor.descriptionSent === 0)
          && typeof toolInput.description === 'string'
          && toolInput.description.trim()
        ) {
          yield { type: 'content' as const, text: `\n\n${toolInput.description.trim()}` };
        }
        const displayInput = isRunCode
          ? directComposition
            ? { ...toolInput, composition: { ...directComposition, code: `[code streamed separately: ${streamedCode.length} chars]` } }
            : { ...toolInput, code: `[code streamed separately: ${streamedCode.length} chars]` }
          : isWriteCodeFile
            ? { ...toolInput, content: `[code streamed separately: ${(toolInput.content as string).length} chars]` }
          : isCompositionPartWrite
            ? { ...toolInput, content: `[code streamed separately: ${(toolInput.content as string).length} chars]` }
          : toolInput;
        yield {
          type: 'tool_call',
          tool: event.toolName,
          toolCallId: activeToolCallId,
          step: stepCount,
          input: toolInput,
          ...(displayInput !== toolInput ? { displayInput } : {}),
          ...(toolCallImages ? { images: toolCallImages } : {}),
        };
        // If code wasn't streamed via delta (edge case), send it now
        if ((isRunCode || isWriteCodeFile || isCompositionPartWrite) && (!codeExtractor || codeExtractor.state === 'waiting')) {
          const code = String(isWriteCodeFile || isCompositionPartWrite ? toolInput.content : streamedCode);
          const CHUNK = 500;
          for (let i = 0; i < code.length; i += CHUNK) {
            yield { type: 'code_stream', text: code.slice(i, i + CHUNK) };
          }
          yield { type: 'code_stream', text: '', done: true };
        }
        completedCodeTargetPath = codeExtractor?.targetPath;
        codeExtractor = null; // reset for next tool call
        continue;
      }

      // ── Tool result — flush generated images + animation task ───────────────
      if (event.type === 'tool-result') {

        const toolName = (event as any).toolName as string | undefined;
        const toolCallId = ((event as any).toolCallId as string | undefined) || activeToolCallId;
        const toolOutput = ((event as any).output ?? (event as any).result) as unknown;
        const toolDuration = toolCallStartTime ? ((Date.now() - toolCallStartTime) / 1000).toFixed(1) : '?';
        console.log(`⏱️ [agent] tool-result "${toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (tool took ${toolDuration}s)`);
        perf?.mark('tool_result', {
          tool: toolName || toolCallName || null,
          step: stepCount,
          sinceAgentStartMs: Date.now() - agentStartTime,
          toolDurationMs: toolCallStartTime ? Date.now() - toolCallStartTime : null,
        });
        // Reset status after tool completes so stale status doesn't linger during thinking
        yield { type: 'status', text: translate(responseLocale, 'agent.status.thinking') };
        if (toolName) {
          yield { type: 'tool_result', tool: toolName, toolCallId, step: stepCount, output: toolOutput };
          const outputRecord = toolOutput && typeof toolOutput === 'object'
            ? toolOutput as Record<string, unknown>
            : undefined;
          const toolSucceeded = outputRecord?.success !== false
            && outputRecord?.status !== 'failed'
            && !(outputRecord?.error && outputRecord?.success !== true);
          if (!toolSucceeded && outputRecord?.terminal === true) {
            const rawMessage = typeof outputRecord.message === 'string'
              ? outputRecord.message
              : typeof outputRecord.error === 'string'
                ? outputRecord.error
                : 'The tool rejected the current input.';
            const localized = outputRecord.userMessage && typeof outputRecord.userMessage === 'object'
              ? outputRecord.userMessage as Record<string, unknown>
              : undefined;
            const localizedMessage = responseLocale.startsWith('zh')
              ? localized?.zh
              : localized?.en;
            const userFacingMessage = typeof localizedMessage === 'string' && localizedMessage.trim()
              ? localizedMessage
              : rawMessage;
            nonRetryableToolFailure = {
              message: rawMessage,
              code: typeof outputRecord.errorCode === 'string' ? outputRecord.errorCode : undefined,
            };
            finalStepTextChars += userFacingMessage.trim().length;
            yield { type: 'content', text: `\n\n${userFacingMessage}` };
          }
          if (completedCodeTargetPath && toolName === 'write_file') {
            const savedPath = typeof outputRecord?.path === 'string' ? outputRecord.path : undefined;
            if (toolSucceeded && (!savedPath || savedPath === completedCodeTargetPath)) {
              (ctx as any).__streamedCodeCheckpoint = undefined;
            }
            completedCodeTargetPath = undefined;
          }
          const compositionWorkspace = outputRecord?.compositionWorkspace && typeof outputRecord.compositionWorkspace === 'object'
            ? outputRecord.compositionWorkspace as Record<string, unknown>
            : undefined;
          if (toolName === 'write_file' && compositionWorkspace) {
            const status = compositionWorkspace.status;
            const partCount = Number(compositionWorkspace.partCount || 0);
            const totalChars = Number(compositionWorkspace.totalChars || 0);
            const diagnostics = Array.isArray(compositionWorkspace.diagnostics)
              ? compositionWorkspace.diagnostics.length
              : 0;
            yield {
              type: 'status',
              text: status === 'ready'
                ? responseLocale.startsWith('zh')
                  ? `Composition 已自动组装并保存 · ${partCount} 个文件 · ${totalChars.toLocaleString()} 字符`
                  : `Composition compiled and autosaved · ${partCount} files · ${totalChars.toLocaleString()} chars`
                : status === 'invalid'
                  ? responseLocale.startsWith('zh')
                    ? `源码已保存，编译发现 ${diagnostics} 个待修复问题`
                    : `Source saved; compilation found ${diagnostics} issue${diagnostics === 1 ? '' : 's'}`
                  : responseLocale.startsWith('zh')
                    ? `源码已保存 · 当前 ${partCount} 个文件`
                    : `Source saved · ${partCount} file${partCount === 1 ? '' : 's'}`,
            };
          }
          if (toolSucceeded && toolName === 'studio_run') {
            const studioSummary = outputRecord?.studioRun && typeof outputRecord.studioRun === 'object'
              ? outputRecord.studioRun as Record<string, unknown>
              : undefined;
            if (
              studioSummary?.currentStage === 'composition'
              && ctx.supabase
              && ctx.userId
            ) {
              try {
                const { ensureStudioCompositionScaffold } = await import('./studio-composition-scaffold');
                const scaffold = await ensureStudioCompositionScaffold({
                  projectId: ctx.projectId,
                  userId: ctx.userId,
                  supabase: ctx.supabase,
                  agentRunId: ctx.agentRunId!,
                });
                if (scaffold.path) (ctx as any).__lastSavedDraftPath = scaffold.path;
                if (scaffold.created) {
                  yield {
                    type: 'status',
                    text: options?.locale === 'en'
                      ? `Composition scaffold saved in ${scaffold.elapsedMs}ms; applying Director craft...`
                      : `Composition 结构骨架已在 ${scaffold.elapsedMs}ms 内保存，正在继续完成导演级画面...`,
                  };
                }
              } catch (scaffoldError) {
                console.error('[agent-execution] composition scaffold failed:', scaffoldError);
              }
            }
          }
          if (toolSucceeded && nonRepeatableTools.has(toolName)) {
            attemptCommittedTools.add(toolName);
          }
          const generatedAudioLine = formatGeneratedAudioForCui(toolName, toolOutput, responseLocale);
          if (generatedAudioLine) {
            yield { type: 'content', text: generatedAudioLine };
          }
        }
        activeToolCallId = undefined;

        // Emit image_analyzed event so frontend can save the description
        if (toolName === 'analyze_image' || toolName === 'analyze_video') {

          const analyzeInput = (event as any).input as { media_index?: number; media_indices?: number[] } | undefined;
          const analyzedIndices = analyzeInput?.media_indices?.length
            ? analyzeInput.media_indices
            : [analyzeInput?.media_index ?? (ctx.currentSnapshotIndex + 1)];
          for (const analyzedIdx of analyzedIndices) {
            yield { type: 'image_analyzed', imageIndex: analyzedIdx };
          }
        }

        // Emit preview_frame_captured so frontend shows the screenshot in CUI
        if (toolName === 'preview_frame') {

          const toolOutput = (event as any).output as { workspaceUrl?: string } | undefined;
          const wsUrl = toolOutput?.workspaceUrl;
          if (wsUrl) {
            yield { type: 'preview_frame_captured' as const, workspaceUrl: wsUrl };
          }
        }

        // Composition output handling — emit design SSE with published flag.
        if (toolName === 'run_code' || toolName === 'write_file' || toolName === 'publish_draft') {
          // Design output stored in ctx.__pendingDesign → emit as SSE event
          const pendingDesign = (ctx as any).__pendingDesign;
          if (pendingDesign) {
            const published = (ctx as any).__pendingDesignPublished ?? false;
            const snapshotId = (ctx as any).__pendingDesignSnapshotId as string | undefined;
            const sourceDesignPath = (ctx as any).__pendingDesignSourcePath as string | undefined;
            // Get preview URL from latest draft (if available)
            const drafts = (ctx as any).__runCodeDrafts as { previewUrl?: string }[] | undefined;
            const previewUrl = drafts?.[drafts.length - 1]?.previewUrl || undefined;
            console.log(`🎨 [agent] emitting render SSE (published=${published}): ${pendingDesign.width}x${pendingDesign.height}, code ${pendingDesign.code?.length} chars${previewUrl ? ', preview: ' + previewUrl.slice(-40) : ''}`);
            yield {
              type: 'render',
              code: pendingDesign.code,
              width: pendingDesign.width,
              height: pendingDesign.height,
              props: pendingDesign.props,
              animation: pendingDesign.animation,
              editables: pendingDesign.editables,
              fontSubstitutions: pendingDesign.fontSubstitutions,
              description: pendingDesign.description,
              snapshotId,
              sourceDesignPath,
              published,
              previewUrl,
            };
            if (published) {
              finalStepDeliveredArtifact = true;
              attemptDeliveredArtifact = true;
            }
            (ctx as any).__pendingDesign = null;
            (ctx as any).__pendingDesignPublished = undefined;
            (ctx as any).__pendingDesignSnapshotId = undefined;
            (ctx as any).__pendingDesignSourcePath = undefined;
          } else if (toolName === 'run_code') {
            console.log(`🔍 [agent] run_code result: no __pendingDesign found`);
          }
          // Image output (from toModelOutput won't have base64Data here, but pushImage in execute already handled it)
        }

        // Detect generate_image failure or NSFW content block
        if (toolName === 'generate_image') {

          const toolResult = (event as any).result as { contentBlocked?: boolean } | undefined;
          if (toolResult?.contentBlocked) {
            yield { type: 'nsfw_detected' };
          }
          if (imagesSent === ctx.generatedImages.length) {
            yield { type: 'status', text: translate(responseLocale, 'agent.status.imageGenerationFailed') };
          }
        }

        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel, metadata: generatedImageMetadata(ctx, ctx.generatedImages[imagesSent]) };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          imagesSent++;
        }
        const hadPendingImageSnapshots = Boolean(ctx.pendingImageSnapshots?.length);
        yield* flushPendingImageSnapshots(ctx);
        if (hadPendingImageSnapshots) {
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
        }
        if (ctx.animationTaskId) {
          yield { type: 'animation_task', taskId: ctx.animationTaskId, prompt: ctx.animationPrompt || '', imageUrls: ctx.animationImageUrls_, model: ctx.animationModel };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          ctx.animationTaskId = undefined;
          ctx.animationPrompt = undefined;
          ctx.animationImageUrls_ = undefined;
          ctx.animationModel = undefined;
        }
        if (ctx.pendingVideoSnapshots?.length) {
          for (const pending of ctx.pendingVideoSnapshots) {
            yield { type: 'video_snapshot', ...pending };
            finalStepDeliveredArtifact = true;
            attemptDeliveredArtifact = true;
          }
          ctx.pendingVideoSnapshots = undefined;
        }
        if (ctx.pendingVideoSnapshot) {
          yield { type: 'video_snapshot', ...ctx.pendingVideoSnapshot };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          ctx.pendingVideoSnapshot = undefined;
        }
        if ((ctx as any).musicTaskId) {
          yield { type: 'music_task', taskId: (ctx as any).musicTaskId };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          (ctx as any).musicTaskId = undefined;
        }
        continue;
      }

      // ── Error from stream ──────────────────────────────────────────────────
      if (event.type === 'error') {
        streamError = (event as any).error;
        console.error(`[agent-stream] provider error: ${describeModelStreamError(streamError)}`);
        // AI SDK emits finish-step (with usage) and finish(error) after the
        // error part. Drain the stream so failed reasoning is still billed and
        // the terminal classification sees the real provider finish reason.
        continue;
      }

        }
      } catch (err) {
        streamError = err;
        console.error(`[agent-stream] stream iteration failed: ${describeModelStreamError(streamError)}`);
      }

      if (streamError) await persistStreamedCodeCheckpoint(true);

      let assessment = nonRetryableToolFailure
        ? {
            ok: true,
            retryable: false,
            code: 'non_retryable_tool_failure' as const,
            detail: nonRetryableToolFailure.message,
          }
        : classifyModelTermination({
              sawFinish,
              finishReason,
              rawFinishReason,
              finalStepTextChars,
              finalStepToolCalls,
              finalStepDeliveredArtifact,
              streamError,
            });

      if (
        !nonRetryableToolFailure
        && (attemptBudgetReached || stepBudgetReached)
      ) {
        assessment = {
          ok: false,
          retryable: true,
          code: 'attempt_budget_handoff',
          detail: attemptBudgetReached
            ? `Attempt time budget reached after a complete step (${invocationBudgetMs}ms); continuing from durable workspace state`
            : `Attempt step budget reached after ${maxSteps} complete steps; continuing from durable workspace state`,
        };
      }

      if (options?.abortSignal?.aborted) {
        const usageEvent = buildUsageEvent();
        if (usageEvent) yield usageEvent;
        return;
      }

      if (assessment.ok) break;

      const subscriptionFailureDetail = streamError
        ? describeModelStreamError(streamError)
        : assessment.detail;
      const canFallbackFromSubscription = (runtime.spec.provider === 'codex-subscription'
        || runtime.spec.provider === 'grok-subscription')
        && !options?.execution
        && !firstContentAt
        && !attemptDeliveredArtifact
        && attemptCommittedTools.size === 0
        && (
          (runtime.spec.provider === 'codex-subscription'
            ? isCodexSubscriptionTerminalFailure(subscriptionFailureDetail)
            : isGrokSubscriptionTerminalFailure(subscriptionFailureDetail))
          || isRetryableProviderOutage(subscriptionFailureDetail)
        );
      if (canFallbackFromSubscription) {
        const subscriptionProvider = runtime.spec.provider;
        const fallbackProvider = subscriptionProvider === 'codex-subscription'
          ? resolveCodexSubscriptionFallbackProvider()
          : 'openrouter';
        const hasFallbackCredential = fallbackProvider === 'azure-openai'
          ? Boolean(process.env.AZURE_OPENAI_API_KEY?.trim())
          : Boolean(process.env.OPENROUTER_API_KEY?.trim());
        if (hasFallbackCredential) {
          try {
            const fallbackRuntime = createAgentModelRuntime(
              runtime.spec.id,
              projectId,
              fallbackProvider,
              options?.userId,
            );
            Object.assign(runtime, fallbackRuntime);
            recoveryAttempt++;
            yield { type: 'status', text: translate(responseLocale, 'agent.status.resuming') };
            console.warn(
              `[agent] ${subscriptionProvider} unavailable before output; retrying ${runtime.spec.id} through ${fallbackProvider}`,
            );
            continue;
          } catch (fallbackError) {
            console.warn(
              `[agent] ${subscriptionProvider} API fallback unavailable: ${describeModelStreamError(fallbackError)}`,
            );
          }
        }
      }

      let attemptSteps: any[] = [];
      try { attemptSteps = await result.steps; } catch { /* stream may have failed before a complete step */ }
      const canRecover = assessment.retryable
        && !options?.execution
        && recoveryAttempt < 1
        && Date.now() - agentStartTime < 600_000;
      if (canRecover) {
        const studioCheckpoint = await getStudioRunCheckpoint(ctx);
        const textOnlyRecovery = attemptDeliveredArtifact;
        recoveryAttempt++;
        recoveryTextOnly = textOnlyRecovery;
        for (const toolName of attemptCommittedTools) recoveryBlockedTools.add(toolName);
        const responseMessages = attemptSteps.flatMap((step: any) => step?.response?.messages ?? []);
        const savedDraftPath = (ctx as any).__lastSavedDraftPath as string | undefined;
        const streamedCheckpoint = (ctx as any).__streamedCodeCheckpoint as StreamedCodeCheckpoint | undefined;
        const studioRecovery = studioCheckpoint.studioRunId
          ? ` Resume Studio Run ${studioCheckpoint.studioRunId} at stage ${studioCheckpoint.studioRunStage}. Call studio_run status first, then continue that stage directly. Do not reread skill, prompt, or reference files already present in the conversation history.`
          : '';
        const compositionRecovery = studioCheckpoint.studioRunStage === 'composition'
          ? ` Switch immediately to numbered source files under ${ctx.projectId}/drafts/composition-parts. Salvage complete reusable definitions from the partial stream into a numbered part, then continue with additional parts; do not stream the monolithic run_code payload again. The workspace assembles automatically after each write, so continue until write_file reports compositionWorkspace.status="ready" and use its designPath directly.`
          : '';
        const recoveryInstruction = textOnlyRecovery
          ? 'A finished artifact was already delivered in the previous step. Do not call any tool, regenerate, republish, or create another task. Only provide the concise final reply for the existing delivered result.'
          : `Continue from the existing tool results and saved draft; do not restart from the original media.${savedDraftPath ? ` The exact saved draft path is: ${savedDraftPath}. If the user should receive an editable composition, call publish_draft with this exact design_path after QA; do not use fromLastRunCode.` : ''}${streamedCheckpoint?.streamedCodePath ? ` Partial streamed code was saved at ${streamedCheckpoint.streamedCodePath} (${streamedCheckpoint.streamedCodeChars || 0} chars); read it once and salvage useful components.` : ''}${studioRecovery}${compositionRecovery}${recoveryBlockedTools.size ? ` Do not repeat these already-completed tools: ${[...recoveryBlockedTools].join(', ')}; use their existing results.` : ''} Complete the pending modification you already planned. If the user requested a finished artifact, publish the updated artifact before your concise final reply.`;
        attemptMessages = [
          ...attemptMessages,
          ...responseMessages,
          {
            role: 'user',
            content: `[System recovery] The previous model step ended before it delivered a usable response (${assessment.code || 'incomplete'}). ${recoveryInstruction}`,
          } as ModelMessage,
        ];
        yield { type: 'status', text: translate(responseLocale, 'agent.status.resuming') };
        console.warn(`[agent] recovering incomplete model step code=${assessment.code} finish=${finishReason || 'missing'} raw=${rawFinishReason || ''}`);
        continue;
      }

      const drafts = (ctx as any).__runCodeDrafts as Array<{ previewUrl?: string }> | undefined;
      const studioCheckpoint = await getStudioRunCheckpoint(ctx);
      const streamedCodeCheckpoint = (ctx as any).__streamedCodeCheckpoint as StreamedCodeCheckpoint | undefined;
      const checkpoint = {
        draftPath: (ctx as any).__lastSavedDraftPath as string | undefined,
        previewUrl: drafts?.[drafts.length - 1]?.previewUrl,
        lastTool: lastTool || toolCallName || undefined,
        finishReason,
        rawFinishReason,
        ...studioCheckpoint,
        ...streamedCodeCheckpoint,
        ...((ctx as any).__compositionPartPaths?.length
          ? { compositionPartPaths: (ctx as any).__compositionPartPaths as string[] }
          : {}),
        ...(assessment.detail ? { errorDetail: assessment.detail } : {}),
      };
      const recoverable = assessment.retryable && Boolean(
        checkpoint.draftPath
        || checkpoint.streamedCodePath
        || checkpoint.compositionPartPaths?.length
        || checkpoint.studioRunId
        || options?.execution,
      );
      const usageEvent = buildUsageEvent();
      if (usageEvent) yield usageEvent;
      yield {
        type: 'error',
        code: assessment.code || 'incomplete_agent_step',
        recoverable,
        checkpoint,
        message: recoverable
          ? translate(responseLocale, 'agent.error.recoverable')
          : translate(responseLocale, 'agent.error.fatal'),
      };
      return;
    }

    // Flush remaining images
    while (imagesSent < ctx.generatedImages.length) {
      yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel, metadata: generatedImageMetadata(ctx, ctx.generatedImages[imagesSent]) };
      imagesSent++;
    }
    yield* flushPendingImageSnapshots(ctx);

    console.log(`⏱️ [agent] DONE total ${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (${imagesSent} images, ${stepCount} steps)`);
    perf?.mark('agent_done', {
      totalAgentMs: Date.now() - agentStartTime,
      imagesSent,
      stepCount,
    });

    // Emit token usage across the initial and automatic recovery attempts.
    // Usage is accumulated from finish-step events so a later timeout cannot
    // erase the tokens already consumed by completed steps.
    const usageEvent = buildUsageEvent();
    if (usageEvent) yield usageEvent;

    yield { type: 'done' };
  } catch (err) {
    const errorMessage = normalizeAgentErrorMessage(err);
    console.log(`⏱️ [agent] ERROR at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s: ${errorMessage}`);
    yield {
      type: 'error',
      message: responseLocale === 'zh' ? errorMessage : translate(responseLocale, 'agent.error.fatal'),
    };
  }
}
