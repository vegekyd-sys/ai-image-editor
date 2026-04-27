/**
 * Server-side prompt context builder for Makaron Agent.
 *
 * Builds the same context blocks that Editor.tsx constructs on the frontend,
 * but from DB queries. This enables headless agent execution (CLI, MCP, API)
 * without any frontend dependency.
 *
 * Frontend-only context (annotation, draft warnings) is passed via options.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignPayload, Tip } from '@/types';
import * as workspace from './workspace';

export interface PromptContextOptions {
  /** 0-based index of the snapshot the user is viewing. Defaults to last. */
  currentSnapshotIndex?: number;
  /** User's text message */
  userMessage: string;
  /** Frontend-only: image has annotations drawn by user */
  hasAnnotation?: boolean;
  /** Frontend-only: viewing a tip draft preview */
  isDraft?: boolean;
  /** Number of attached reference images */
  referenceImageCount?: number;
}

export interface PromptContextResult {
  fullPrompt: string;
  snapshotImages: string[];
  currentSnapshotIndex: number;
  currentDesign?: DesignPayload;
  originalImage?: string;
}

interface DbSnapshot {
  id: string;
  image_url: string;
  description?: string;
  type?: string;
  design_path?: string;
  tips: Tip[];
  sort_order: number;
}

interface DbMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function buildPromptContext(
  projectId: string,
  supabase: SupabaseClient,
  userId: string,
  options: PromptContextOptions,
): Promise<PromptContextResult> {
  const { userMessage, hasAnnotation, isDraft, referenceImageCount } = options;

  // Query snapshots and messages in parallel
  const [snapshotsRes, messagesRes] = await Promise.all([
    supabase
      .from('snapshots')
      .select('id, image_url, description, type, design_path, tips, sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ]);

  const snapshots: DbSnapshot[] = snapshotsRes.data ?? [];
  const messages: DbMessage[] = messagesRes.data ?? [];

  const currentSnapshotIndex = options.currentSnapshotIndex ?? Math.max(0, snapshots.length - 1);
  const currentSnap = snapshots[currentSnapshotIndex];

  // Load design from workspace if current snapshot has one
  let currentDesign: DesignPayload | undefined;
  if (currentSnap?.design_path) {
    try {
      const file = await workspace.readFile(currentSnap.design_path, supabase, userId);
      if (file) currentDesign = JSON.parse(file.content);
    } catch { /* design load failed, continue without */ }
  }

  // --- Build context blocks (same format as Editor.tsx) ---

  // Description
  const descriptionContext = currentSnap?.description
    ? `[图片分析结果]\n${currentSnap.description}\n\n`
    : '';

  // Conversation history
  const recentMessages = messages
    .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
    .slice(-200)
    .map(m => `[${m.role === 'user' ? '用户' : 'Makaron'}] ${m.content.slice(0, 2000)}`)
    .join('\n');
  const historyContext = recentMessages
    ? `[对话历史]\n${recentMessages}\n\n`
    : '';

  // Tips
  const currentTips: Tip[] = Array.isArray(currentSnap?.tips) ? currentSnap.tips : [];
  const tipsContext = currentTips.length > 0
    ? `[当前TipsBar中的编辑建议]\n${currentTips.map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`).join('\n')}\n\n`
    : '';

  // Snapshot warning (viewing intermediate version)
  const isIntermediateSnapshot = currentSnapshotIndex < snapshots.length - 1;
  const snapshotWarning = isIntermediateSnapshot
    ? `[重要提示] 用户当前正在编辑的是第 ${currentSnapshotIndex + 1} 个版本（共 ${snapshots.length} 个），不是最新版本。对话历史描述的是其他版本的状态，与当前图片无关。请完全以传入的当前图片为准，忽略对话历史中对图片内容的描述。\n\n`
    : '';

  // Snapshot index
  const snapshotIndexContext = snapshots.length > 1
    ? `[图片索引 / Image Index — ${snapshots.length} snapshots]\n${snapshots.map((s, i) => {
        const isRef = s.type === 'reference';
        const isDesign = !!s.design_path;
        const desc = isRef
          ? (s.description || 'Skill reference image')
          : isDesign
            ? (s.description || '[design/video]')
            : i === 0 || snapshots.slice(0, i).every(ss => ss.type === 'reference')
              ? (s.description || '原图 / Original upload')
              : (s.description || '(use analyze_image to see this snapshot)');
        const tag = isRef ? ' (reference)' : isDesign ? ' (design)' : '';
        const marker = i === currentSnapshotIndex ? '  ← YOU ARE HERE' : '';
        const codePath = isDesign && s.design_path ? ` [code: ${s.design_path}]` : '';
        return `<<<image_${i + 1}>>>${tag}${marker} — ${desc}${codePath}`;
      }).join('\n')}\n\n`
    : '';

  // Design warning
  const designWarning = currentDesign
    ? `[DESIGN MODE] You are viewing a design/video (not a photo). The design code is provided above. Do NOT call analyze_image — it only shows a static poster frame, not the actual content. Read the code and description to understand this design.\n\n`
    : '';

  // Design editable state
  const designContext = currentDesign?.editables?.length
    ? `[Design Editable State]\n${currentDesign.editables.map(f =>
        `- ${f.label} (${f.propKey}): "${(currentDesign!.props as Record<string, unknown>)?.[f.propKey] ?? ''}"`
      ).join('\n')}\nUser may have edited these values in the GUI. To modify the design, use run_code with { type: 'patch', edits: [...] }.\n\n`
    : '';

  // Frontend-only warnings
  const annotationWarning = hasAnnotation
    ? `[ANNOTATION MODE] The current image has red annotations drawn by the user. You MUST edit THIS image based on the annotations — do NOT use image_index to switch to another snapshot. Call analyze_image first (without image_index) to see the annotations, then generate_image (without image_index) to edit.\n\n`
    : '';

  const draftWarning = isDraft
    ? `[DRAFT PREVIEW MODE] The user is viewing a tip preview (not yet committed). This draft image is NOT in the image index. Omit image_index to edit this draft directly.\n\n`
    : '';

  const refContext = referenceImageCount
    ? `[用户上传了 ${referenceImageCount} 张参考图，已自动传给 generate_image 工具使用]\n\n`
    : '';

  // Assemble (same order as Editor.tsx)
  const fullPrompt = `${designWarning}${annotationWarning}${draftWarning}${snapshotWarning}${descriptionContext}${snapshotIndexContext}${designContext}${tipsContext}${historyContext}${refContext}[User request — detect language and reply in the same language]\n${userMessage}`;

  const snapshotImages = snapshots.map(s => s.image_url || '');
  const originalImage = snapshots[0]?.image_url || undefined;

  return {
    fullPrompt,
    snapshotImages,
    currentSnapshotIndex,
    currentDesign,
    originalImage,
  };
}
