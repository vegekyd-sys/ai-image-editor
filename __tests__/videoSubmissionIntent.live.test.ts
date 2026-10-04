// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { streamText, stepCountIs } from 'ai';
import { expect, it, vi } from 'vitest';
import { createAgentModelRuntime, getAgentProviderOptions } from '@/lib/agent-model-runtime';
import { createVideo } from '@/lib/skills/create-video';
import { waitForFalH3MaxVideoTask } from '@/lib/fal-h3-max-video';
import { findFfprobe } from '@/lib/ffmpeg-runtime';
import { generateAnimationHarness } from './helpers/generateAnimationHarness';

// Explicitly opt-in: one real 5-second H3 Max request, real Codex tool selection,
// but an isolated wallet and snapshot store. Never mutate the source project.
it.skipIf(process.env.MAKARON_VIDEO_INTENT_LIVE !== '1')('submits one real H3 Max clip from one real Agent call', async () => {
  const projectId = process.env.MAKARON_VIDEO_INTENT_PROJECT_ID;
  if (!projectId) throw new Error('Set MAKARON_VIDEO_INTENT_PROJECT_ID explicitly');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rows, error } = await db.from('snapshots').select('id,type,image_url')
    .eq('project_id', projectId).order('sort_order').limit(2);
  if (error) throw new Error(error.message);
  expect(rows).toHaveLength(2);
  expect(rows![1].type).not.toBe('video');
  const h = generateAnimationHarness();
  h.ctx.snapshotImages = rows!.map(row => row.image_url);
  const runtime = createAgentModelRuntime('gpt-5.6-terra', 'video-intent-smoke', 'codex-subscription',
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID, true);
  h.createVideo.mockImplementation(createVideo);
  const execute = h.tool.execute;
  let toolCalls = 0;
  let taskId: string | undefined;
  let args: Record<string, any> | undefined;
  const startedAt = Date.now();
  let submittedAt = 0;
  h.tool.execute = async (input: Record<string, any>) => {
    toolCalls++;
    // Bound real provider cost even if the Agent unexpectedly attempts a retry.
    if (toolCalls > 1) throw new Error('Smoke permits only one tool submission');
    args = input;
    expect(input.replication_contract == null).toBe(true);
    expect(input.video_intent ?? 'generate').toBe('generate');
    expect(input.story_prompt).toContain('<<<media_2>>>');
    expect(input.story_prompt).not.toContain('<<<media_1>>>');
    const result = await execute(input);
    expect(result.success, result.message).toBe(true);
    taskId = result.taskId;
    submittedAt = Date.now();
    return result;
  };
  const stream = streamText({
    model: runtime.model,
    system: readFileSync('src/lib/prompts/animate.md', 'utf8'),
    prompt: 'Media Index: <<<media_1>>> 原始人像；<<<media_2>>> 已生成的16:9杂志主视觉，保留同一女生。没有源视频。\n脚本已确认：时尚造型图册；Shot 1 (5s): 以<<<media_2>>>为唯一首帧，女生自然转头，闪光灯照亮暗红杂志摄影棚，保留脸和服装，原生电子时尚音乐。使用H3 Max Turbo、768p、5秒，直接提交，不必再次确认。指南已在系统消息完整加载。',
    tools: { generate_animation: h.tool },
    stopWhen: stepCountIs(2), maxRetries: 0,
    providerOptions: getAgentProviderOptions(runtime),
    abortSignal: AbortSignal.timeout(90_000),
  });
  await stream.consumeStream({ onError: error => { throw error; } });
  expect(toolCalls).toBe(1);
  expect(taskId).toBeTruthy();
  expect(h.createVideo).toHaveBeenCalledTimes(1);
  expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);
  expect(h.deductFixedCredits.mock.calls[0][1]).toBe(40);
  expect(h.ctx.pendingVideoSnapshot.videoMeta.sourceUrls).toEqual([rows![1].image_url]);
  const result = await waitForFalH3MaxVideoTask(taskId!, { timeoutMs: 45_000, pollIntervalMs: 1000 });
  expect(result?.status).toBe('completed');
  expect(result?.videoUrl).toMatch(/^https:\/\//);
  const probe = spawnSync(await findFfprobe(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', result!.videoUrl!], { encoding: 'utf8', timeout: 30_000 });
  expect(probe.status).toBe(0);
  const media = JSON.parse(probe.stdout);
  expect(Number(media.format.duration)).toBeGreaterThanOrEqual(5);
  expect(media.streams.some((stream: any) => stream.codec_type === 'video')).toBe(true);
  console.log('VIDEO_INTENT_LIVE', JSON.stringify({
    taskId, toolCalls, providerSubmissions: h.createVideo.mock.calls.length,
    selectedMedia: 2, replicationContractPresent: args?.replication_contract != null,
    agentToSubmitMs: submittedAt - startedAt, completedMs: Date.now() - startedAt,
    isolatedWalletDebit: h.deductFixedCredits.mock.calls[0][1], productionWrites: 0,
    videoUrl: result!.videoUrl, media,
  }));
  vi.restoreAllMocks();
}, 150_000);
