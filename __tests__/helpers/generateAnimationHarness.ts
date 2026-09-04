import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { vi } from 'vitest';
import * as capabilities from '@/lib/video-model-capabilities';
import { validateVideoScript } from '@/lib/video-harness';
import { resolveAudioRefs } from '@/lib/audio-reference-resolver';
import { compileVideoReplicationPrompt } from '@/lib/video-replication-prompt';
import { createVideoValidationReporter } from '@/lib/video-submission-validation';
import { preserveOptionalToolFields } from '@/lib/agent-tool-schema';
import { calculateMediaQuote, videoPriceId, type VideoQuoteInput } from '@/lib/billing/media-pricing';
import { seededMediaPrices } from './media-prices';

// Execute the real factory without booting every unrelated media SDK. Only
// external effects are injected; script validation, routing and pricing are real.
const source = readFileSync('src/lib/agent-tools.ts', 'utf8');
const parsed = ts.createSourceFile('agent-tools.ts', source, ts.ScriptTarget.Latest, true);
const factory = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createGenerateAnimationTool');
if (!factory) throw new Error('Missing generate_animation factory');
const code = ts.transpileModule(factory.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

export function generateAnimationHarness() {
  const rows: Array<Record<string, any>> = [
    { id: 'original', type: 'image' }, { id: 'generated', type: 'image' },
  ];
  const insert = vi.fn().mockResolvedValue({ error: null });
  const query: any = {
    select: () => query, eq: () => query,
    order: async () => ({ data: rows, error: null }),
    insert, update: () => query,
  };
  const db = { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: 2 }) };
  const createVideo = vi.fn().mockImplementation(async input => {
    await input.onBeforeProviderSubmit?.({ model: input.videoModel, resolution: input.videoResolution, durationSec: input.duration ?? 5, imageCount: 1, operation: input.videoOperation });
    return { success: true, taskId: 'fal-h3max-turbo-test' };
  });
  const requireCredits = vi.fn().mockResolvedValue({ ok: true, balance: 1000 });
  const deductFixedCredits = vi.fn().mockImplementation(async (_u, credits) => ({ charged: credits }));
  const refundCredits = vi.fn();
  const probeVideoMetadataFromUrl = vi.fn(async (url: string): Promise<{ duration: number } | null> => ({
    duration: rows.find(row => row.video_meta?.videoUrl === url)?.video_meta?.duration ?? 1,
  }));
  const ctx: any = {
    userId: 'test-user', projectId: 'test-project', supabase: db,
    snapshotImages: ['https://example.com/original.jpg', 'https://example.com/generated.jpg'],
    videoAuto: true, videoModel: 'seedance-fast',
  };
  const context = vm.createContext({
    ...capabilities, z, tool: (value: unknown) => value, crypto: webcrypto,
    createVideoValidationReporter, compileVideoReplicationPrompt, resolveAudioRefs,
    refreshSnapshotUrls: vi.fn(), createVideo, requireCredits, deductFixedCredits, refundCredits,
    quoteVideo: async (input: VideoQuoteInput) => {
      const price = seededMediaPrices().find(row => row.id === videoPriceId(input));
      if (!price) throw new Error(`Missing test price: ${videoPriceId(input)}`);
      return calculateMediaQuote(price, input);
    },
    isInsufficientCreditsError: () => false,
    isGrokSubscriptionAllowedUser: async () => false,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    require: (name: string) => {
      if (name === './video-harness') return { validateVideoScript };
      if (name === './video-metadata') return { probeVideoMetadataFromUrl };
      if (name === '@/lib/supabase/service') return { getSupabaseAdmin: () => db };
      if (name === '@/lib/editor/timeline-derivations') return { VIDEO_PLACEHOLDER_IMAGE: '/video-placeholder.png' };
      if (name === '@/lib/provider-video-reference') return {
        prepareProviderVideoReferences: async ({ urls }: { urls: string[] }) => ({ urls, normalized: [] }),
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const create = vm.runInContext(`${code}\ncreateGenerateAnimationTool`, context);
  const tool = create({ ctx, serializeVideoSubmission: (operation: () => unknown) => operation() });
  preserveOptionalToolFields({ generate_animation: tool }, 'codex-subscription');
  return { tool, ctx, rows, db, insert, createVideo, requireCredits, deductFixedCredits, refundCredits, probeVideoMetadataFromUrl };
}

// Reduced from the observed four failing calls: every unused optional field was
// filled and the fake replication object introduced media_1 into a media_2 clip.
export const lookbookRequest = {
  model: 'minimax-h3-max', duration: 15, aspect_ratio: '16:9', video_resolution: '768p',
  story_prompt: '时尚造型图册\n主角为<<<media_2>>>，唯一首帧。Shot 1 (15s): Fashion lookbook with coherent identity, outfit transitions and native music.',
  audio_refs: [], media_refs: [], web_search: false, output_format: 'mp4',
  video_ref_url: '', content_filter: true, generate_audio: true, motion_control: false,
  video_ref_type: 'feature', video_operation: 'generate', extend_direction: 'forward',
  completion_actions: [], keep_original_sound: false, reference_voice_ids: [],
  character_orientation: 'image',
  replication_contract: {
    reference_video_media_index: 1, source_duration_seconds: 1,
    characters: [{ replacement_media_index: 1, source_actor_anchor: 'placeholder identification', replacement_identity: 'placeholder' }],
    objects: [], environment: { replacement_media_index: 1, source_environment_anchor: 'placeholder environment', replacement_environment: 'placeholder environment' },
    style_direction: '', additional_exclusions: [],
  },
};
