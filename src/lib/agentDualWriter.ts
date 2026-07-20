import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentStreamEvent } from './agent';
import { uploadImage } from './supabase/storage';
import { sanitizeToolHistory, type ToolHistoryBudget } from './agentToolHistory';

const EVENT_WRITE_RETRY_DELAYS_MS = [0, 75, 250, 750] as const;

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && chain.length < 6 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return chain;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
}

function isDuplicateWrite(error: unknown): boolean {
  return errorChain(error).some(item => errorCode(item) === '23505');
}

function isTransientWriteError(error: unknown): boolean {
  const values = errorChain(error);
  const codes = values.map(errorCode).join(' ');
  const messages = values.map(errorMessage).join(' ');
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR|ABORT_ERR/i.test(codes)
    || /fetch failed|network|socket|timed?\s*out|timeout|connection reset|\b(?:429|502|503|504)\b/i.test(messages);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Server-side persistence for agent events. Handles:
 * 1. agent_events table (always — for replay/audit)
 * 2. snapshots table (always — single source of truth)
 * 3. messages table (always — single source of truth)
 * 4. SSE stream (enriched events with server-generated IDs)
 *
 * The frontend receives enriched events (with snapshotId, imageUrl, messageId)
 * and uses the server's IDs instead of generating its own. Both sides reference
 * the same IDs → upsert is idempotent, no duplicates.
 */
export class AgentDualWriter {
  private seq = 0;
  private contentBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private codeStreamBuffer = '';
  private codeStreamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private sseDisconnected = false;

  // Message accumulation
  private messageText = '';
  private currentMessageId = crypto.randomUUID();
  private currentMessageHasImage = false;
  private currentTurnHasDelivery = false;
  private pendingToolCalls = new Map<string, {
    tool: string;
    input: Record<string, unknown>;
    step: number;
  }>();
  private toolHistorySeq = 0;
  private toolHistoryBudget: ToolHistoryBudget = { rows: 0, chars: 0 };

  constructor(
    private runId: string,
    private supabase: SupabaseClient,
    private userId: string,
    private projectId: string,
    private controller?: ReadableStreamDefaultController | null,
    private encoder?: TextEncoder | null,
    initialMessageId?: string | null,
  ) {
    if (initialMessageId) this.currentMessageId = initialMessageId;
  }

  /** Write enriched event to SSE stream. No-op in headless mode (no controller). */
  tryEnqueue(event: Record<string, unknown>) {
    if (this.sseDisconnected || !this.controller || !this.encoder) return;
    try {
      this.controller.enqueue(
        this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    } catch {
      this.sseDisconnected = true;
      void this.flushContent();
    }
  }

  /**
   * Process event: write to DB, return enriched event for SSE.
   * The enriched event includes server-generated IDs (snapshotId, imageUrl, messageId).
   */
  async processAndEnqueue(event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
      case 'content': {
        this.contentBuffer += event.text;
        this.messageText += event.text;
        // SSE: send immediately
        this.tryEnqueue(event);
        // DB: batch content writes (50 chars or 500ms — not per-token)
        if (this.contentBuffer.length >= 50) {
          await this.flushContent();
        } else if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => this.flushContent(), 500);
        }
        return;
      }

      case 'image': {
        await this.flushContent();
        const prePublishedSnapshotId = event.snapshotId;
        const prePublishedImageUrl = event.imageUrl || (event.image.startsWith('http') ? event.image : undefined);
        const snapshotId = prePublishedSnapshotId || crypto.randomUUID();
        let imageUrl = prePublishedImageUrl || null;

        if (!imageUrl) {
          const filename = `snapshot-${snapshotId}.jpg`;
          imageUrl = await uploadImage(
            this.supabase, this.userId, this.projectId, filename, event.image,
          );
        }

        // Write snapshots table
        if (imageUrl && !prePublishedSnapshotId) {
          const sortOrder = await this.nextSortOrder();
          const { error } = await this.supabase.from('snapshots').upsert({
            id: snapshotId,
            project_id: this.projectId,
            image_url: imageUrl,
            tips: [],
            message_id: this.currentMessageId,
            sort_order: sortOrder,
          }, { onConflict: 'id' });
          if (error) throw new Error(`Failed to persist generated image snapshot: ${error.message}`);
          this.currentMessageHasImage = true;
          this.currentTurnHasDelivery = true;
        } else if (imageUrl) {
          this.currentMessageHasImage = true;
          this.currentTurnHasDelivery = true;
        }

        // Write agent_events
        await this.insertEvent('image', {
          snapshotId,
          imageUrl: imageUrl ?? undefined,
          usedModel: event.usedModel,
          description: event.description,
        });

        // SSE: enriched event with server IDs
        this.tryEnqueue({
          type: 'image',
          image: event.image,
          usedModel: event.usedModel,
          snapshotId,
          imageUrl,
        });
        return;
      }

      case 'render':  // agent.ts now yields 'render'; 'design' kept for backward compat
      case 'design': {
        await this.flushContent();

        const published = (event as any).published === true;

        if (published) {
          // Published design — create real Snapshot in DB
          const snapId = crypto.randomUUID();
          const designPath = `code/${snapId}.json`;

          const designDesc = (event as any).description as string | undefined;
          const designJson = JSON.stringify({
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation,
            ...((event as Record<string, unknown>).editables ? { editables: (event as Record<string, unknown>).editables } : {}),
            ...((event as Record<string, unknown>).fontSubstitutions ? { fontSubstitutions: (event as Record<string, unknown>).fontSubstitutions } : {}),
          });

          // Upload design JSON to workspace + index in workspace_files for agent read_file
          const storagePath = `${this.userId}/workspace/${designPath}`;
          const { error: designUploadError } = await this.supabase.storage.from('images')
            .upload(storagePath, new Blob([designJson], { type: 'application/json' }), { upsert: true });
          if (designUploadError) {
            throw new Error(`Failed to persist published design: ${designUploadError.message}`);
          }
          const { data: urlData } = this.supabase.storage.from('images').getPublicUrl(storagePath);
          const { error: workspaceIndexError } = await this.supabase.from('workspace_files').upsert({
            user_id: this.userId,
            path: designPath,
            content_type: 'application/json',
            size_bytes: designJson.length,
            storage_url: urlData?.publicUrl || '',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,path' });
          if (workspaceIndexError) {
            throw new Error(`Failed to index published design: ${workspaceIndexError.message}`);
          }

          // Write snapshots table
          const sortOrder = await this.nextSortOrder();
          const { error: snapshotError } = await this.supabase.from('snapshots').upsert({
            id: snapId,
            project_id: this.projectId,
            image_url: '',
            tips: [],
            message_id: this.currentMessageId,
            sort_order: sortOrder,
            description: designDesc || '[composition]',
            design_path: designPath,
          }, { onConflict: 'id' });
          if (snapshotError) {
            throw new Error(`Failed to persist published design snapshot: ${snapshotError.message}`);
          }
          this.currentMessageHasImage = true;
          this.currentTurnHasDelivery = true;

          // Write agent_events
          await this.insertEvent(event.type, {
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation,
            fontSubstitutions: (event as Record<string, unknown>).fontSubstitutions,
            snapshotId: snapId, published: true,
          });

          // SSE: enriched with snapshotId, normalize type to 'render'
          this.tryEnqueue({ ...event, type: 'render', snapshotId: snapId, published: true });
        } else {
          // Draft design — preview only, no DB snapshot
          await this.insertEvent(event.type, {
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation,
            fontSubstitutions: (event as Record<string, unknown>).fontSubstitutions,
            published: false,
          });

          // SSE: pass through as draft (no snapshotId)
          this.tryEnqueue({ ...event, type: 'render', published: false });
        }
        return;
      }

      case 'new_turn': {
        await this.flushContent();
        // Save current message
        await this.saveCurrentMessage();
        this.messageText = '';
        this.currentMessageId = crypto.randomUUID();
        this.currentMessageHasImage = false;
        this.currentTurnHasDelivery = false;
        await this.insertEvent('new_turn', { messageId: this.currentMessageId });
        // SSE: include new messageId
        this.tryEnqueue({ type: 'new_turn', messageId: this.currentMessageId });
        return;
      }

      case 'done': {
        if (!this.messageText.trim() && !this.currentTurnHasDelivery) {
          throw new Error('Refusing empty agent completion without final text or a delivered artifact');
        }
        await this.flushContent();
        await this.saveCurrentMessage(true);
        await this.insertEvent('done', {}, true);
        this.tryEnqueue(event);
        return;
      }

      case 'error': {
        await this.flushContent();
        if (event.message && !this.messageText.includes(event.message)) {
          this.messageText = this.messageText.trim()
            ? `${this.messageText.trimEnd()}\n\n${event.message}`
            : event.message;
        }
        await this.saveCurrentMessage(true);

        const { type, ...data } = event as Record<string, unknown>;
        await this.insertEvent('error', data, true);
        this.tryEnqueue(event);
        return;
      }

      case 'tool_call': {
        await this.flushContent();
        await this.saveCurrentMessage();
        const input = this.sanitizeToolInputForHistory(event.input);
        const displayInput = event.displayInput
          ? this.sanitizeToolInputForDisplay(event.displayInput)
          : this.sanitizeToolInputForDisplay(input);
        if (event.toolCallId) {
          this.pendingToolCalls.set(event.toolCallId, {
            tool: event.tool,
            input,
            step: event.step ?? 0,
          });
        }
        await this.insertEvent('tool_call', { tool: event.tool, input: displayInput });
        this.tryEnqueue({ ...event, input: displayInput });
        return;
      }

      case 'tool_result': {
        await this.flushContent();
        await this.persistToolResult(event);
        return;
      }

      case 'preview_frame_captured': {
        await this.flushContent();
        this.currentMessageHasImage = true;
        await this.saveCurrentMessage();
        await this.insertEvent('preview_frame_captured', {
          workspaceUrl: event.workspaceUrl,
          messageId: this.currentMessageId,
        });
        this.tryEnqueue(event);
        return;
      }

      case 'status': {
        await this.flushContent();
        await this.insertEvent('status', { text: event.text });
        this.tryEnqueue(event);
        return;
      }

      case 'context_compaction': {
        await this.flushContent();
        await this.insertEvent('context_compaction', {
          provider: event.provider,
          modelId: event.modelId,
          compactedThrough: event.compactedThrough,
          summary: event.summary,
          appliedEdits: event.appliedEdits,
          item: event.item ? {
            kind: event.item.kind,
            providerKey: event.item.providerKey,
            itemId: event.item.itemId,
            encryptedContent: '[persisted in context snapshot]',
          } : undefined,
          inputTokens: event.inputTokens,
        });
        // Provider compaction is model state, not visible assistant copy.
        return;
      }

      case 'coding': {
        await this.insertEvent('coding', {});
        this.tryEnqueue(event);
        return;
      }

      case 'code_stream': {
        this.codeStreamBuffer += event.text;
        this.tryEnqueue(event);
        if (event.done) {
          await this.flushCodeStream(true);
        } else if (this.codeStreamBuffer.length >= 1_000) {
          await this.flushCodeStream(false);
        } else if (!this.codeStreamFlushTimer) {
          this.codeStreamFlushTimer = setTimeout(() => {
            void this.flushCodeStream(false);
          }, 300);
        }
        return;
      }

      case 'animation_task':
      case 'video_snapshot':
      case 'image_analyzed':
      case 'nsfw_detected': {
        await this.flushContent();

        if (event.type === 'animation_task' || event.type === 'video_snapshot') {
          this.currentTurnHasDelivery = true;
        }

        const { type: _t, ...rest } = event as Record<string, unknown>;
        await this.insertEvent(event.type, rest);
        this.tryEnqueue(event);
        return;
      }

      case 'music_task': {
        await this.flushContent();
        this.currentTurnHasDelivery = true;
        const { type: _t, ...rest } = event as Record<string, unknown>;
        await this.insertEvent(event.type, rest);
        this.tryEnqueue(event);
        return;
      }

      default:
        // High-frequency events (reasoning, coding, code_stream): SSE only, no DB
        this.tryEnqueue(event);
        return;
    }
  }

  /** Flush pending content buffer to agent_events. */
  async flushContent() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.contentBuffer) return;
    const text = this.contentBuffer;
    this.contentBuffer = '';
    await this.insertEvent('content', { text });
  }

  async flushCodeStream(done: boolean) {
    if (this.codeStreamFlushTimer) {
      clearTimeout(this.codeStreamFlushTimer);
      this.codeStreamFlushTimer = null;
    }
    const text = this.codeStreamBuffer;
    this.codeStreamBuffer = '';
    if (!text && !done) return;
    await this.insertEvent('code_stream', { text, done: done || undefined });
  }

  /** Call in after() or finally block. */
  async flush() {
    await this.flushContent();
    await this.flushCodeStream(false);
  }

  /** Get the current message ID (for the first message before any new_turn). */
  get firstMessageId() { return this.currentMessageId; }

  /** Continue one execution's append-only event sequence across worker attempts. */
  async initializeSequence() {
    const { data, error } = await this.supabase
      .from('agent_events')
      .select('seq')
      .eq('run_id', this.runId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to initialize Agent event sequence: ${error.message}`);
    this.seq = typeof data?.seq === 'number' ? data.seq + 1 : 0;
  }

  async beginContinuationTurn() {
    await this.insertEvent('new_turn', { messageId: this.currentMessageId });
    this.tryEnqueue({ type: 'new_turn', messageId: this.currentMessageId });
  }

  /** Durable liveness lease used to reconcile platform-killed runs. */
  async persistHeartbeat() {
    await this.insertEvent('heartbeat', { at: new Date().toISOString() });
  }

  /** Save accumulated message text to messages table. */
  private async saveCurrentMessage(required = false) {
    if (!this.messageText.trim() && !this.currentMessageHasImage) return;
    try {
      const { error } = await this.supabase.from('messages').upsert({
        id: this.currentMessageId,
        project_id: this.projectId,
        role: 'assistant',
        content: this.messageText,
        has_image: this.currentMessageHasImage,
      }, { onConflict: 'id' });
      if (error) throw error;
    } catch (err) {
      console.error('[DualWriter] message upsert error:', err);
      if (required) throw err;
    }
  }

  /** Get next sort_order for snapshots in this project (atomic). */
  private async nextSortOrder(): Promise<number> {
    try {
      const { data } = await this.supabase.rpc('next_sort_order', { p_project_id: this.projectId });
      return data ?? 0;
    } catch {
      return Date.now();
    }
  }

  private async insertEvent(type: string, data: Record<string, unknown>, required = false) {
    const row = {
      id: crypto.randomUUID(),
      run_id: this.runId,
      project_id: this.projectId,
      type,
      data,
      seq: this.seq++,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < EVENT_WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
      const delayMs = EVENT_WRITE_RETRY_DELAYS_MS[attempt];
      if (delayMs) await sleep(delayMs);
      try {
        const { error } = await this.supabase.from('agent_events').insert(row);
        if (error) throw error;
        return;
      } catch (err) {
        if (isDuplicateWrite(err)) return;
        lastError = err;
        const canRetry = isTransientWriteError(err) && attempt < EVENT_WRITE_RETRY_DELAYS_MS.length - 1;
        if (!canRetry) break;
        console.warn(`[DualWriter] transient event write failure (${type}, retry ${attempt + 1})`, err);
      }
    }
    console.error('[DualWriter] Failed to insert event:', type, lastError);
    if (required) throw lastError;
  }

  private sanitizeToolInputForHistory(input: Record<string, unknown>) {
    const safe = { ...input };
    delete safe.image;
    delete safe.images;
    return safe;
  }

  private sanitizeToolInputForDisplay(input: Record<string, unknown>) {
    const safe = { ...input };
    delete safe.image;
    delete safe.images;
    if (typeof safe.code === 'string' && safe.code.length > 2000) {
      safe.code = `[code streamed separately: ${safe.code.length} chars]`;
    }
    return safe;
  }

  private async persistToolResult(event: Extract<AgentStreamEvent, { type: 'tool_result' }>) {
    if (!event.toolCallId) {
      await this.insertEvent('tool_result_unmatched', {
        tool: event.tool,
        reason: 'missing_tool_call_id',
      });
      return;
    }

    const pending = this.pendingToolCalls.get(event.toolCallId);
    if (!pending) {
      await this.insertEvent('tool_result_unmatched', {
        tool: event.tool,
        toolCallId: event.toolCallId,
        reason: 'missing_pending_tool_call',
      });
      return;
    }

    const sanitized = sanitizeToolHistory(
      pending.tool,
      pending.input,
      event.output,
      this.toolHistoryBudget,
    );
    this.toolHistoryBudget.rows += 1;
    this.toolHistoryBudget.chars += sanitized.inputChars + sanitized.outputChars;
    this.pendingToolCalls.delete(event.toolCallId);
    if (pending.tool === 'analyze_video') {
      await this.maybePersistVideoAnalysisDescription(pending.input, event.output);
    }
    if (pending.tool === 'studio_run') {
      await this.maybePersistStudioRunEvent(event.output);
    }

    try {
      await this.supabase.from('agent_tool_history').insert({
        run_id: this.runId,
        project_id: this.projectId,
        user_id: this.userId,
        step: pending.step,
        seq: this.toolHistorySeq++,
        tool_call_id: event.toolCallId,
        tool_name: pending.tool,
        input: sanitized.input,
        output: sanitized.output,
        omitted: sanitized.omitted,
        input_chars: sanitized.inputChars,
        output_chars: sanitized.outputChars,
      });
      await this.insertEvent('tool_result', {
        tool: pending.tool,
        toolCallId: event.toolCallId,
        omitted: sanitized.omitted,
        inputChars: sanitized.inputChars,
        outputChars: sanitized.outputChars,
      });
    } catch (err) {
      console.error('[DualWriter] Failed to persist tool history:', err);
      await this.insertEvent('tool_result_persist_error', {
        tool: pending.tool,
        toolCallId: event.toolCallId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async maybePersistStudioRunEvent(output: unknown) {
    if (!output || typeof output !== 'object') return;
    const result = output as Record<string, unknown>;
    if (Array.isArray(result.studioRunUpdates)) {
      for (const update of result.studioRunUpdates) {
        if (!update || typeof update !== 'object') continue;
        const item = update as Record<string, unknown>;
        if (!item.studioRun || typeof item.studioRun !== 'object') continue;
        await this.insertEvent('studio_run', {
          ...(item.studioRun as Record<string, unknown>),
          ...(typeof item.artifactPath === 'string' ? { artifactPath: item.artifactPath } : {}),
          ...(Array.isArray(item.invalidated) ? { invalidated: item.invalidated } : {}),
        });
      }
      return;
    }
    const studioRun = result.studioRun;
    if (!studioRun || typeof studioRun !== 'object') return;
    await this.insertEvent('studio_run', {
      ...(studioRun as Record<string, unknown>),
      ...(typeof result.statePath === 'string' ? { statePath: result.statePath } : {}),
      ...(typeof result.artifactPath === 'string' ? { artifactPath: result.artifactPath } : {}),
      ...(Array.isArray(result.invalidated) ? { invalidated: result.invalidated } : {}),
    });
  }

  private normalizeSnapshotDescription(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.slice(0, 800);
  }

  private async maybePersistVideoAnalysisDescription(input: Record<string, unknown>, output: unknown) {
    const outputRecord = output && typeof output === 'object' ? output as Record<string, unknown> : {};
    const batchAnalyses = Array.isArray(outputRecord.analyses) ? outputRecord.analyses : [];
    const entries = batchAnalyses.length
      ? batchAnalyses.map(item => {
          const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
          return { mediaIndex: record.media_index, analysis: record.analysis };
        })
      : [{ mediaIndex: input.media_index, analysis: outputRecord.analysis }];

    try {
      const { data: snaps, error } = await this.supabase
        .from('snapshots')
        .select('id, description')
        .eq('project_id', this.projectId)
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('[DualWriter] video description snapshot lookup error:', error);
        return;
      }
      await Promise.all(entries.map(async entry => {
        const mediaIndex = typeof entry.mediaIndex === 'number' ? entry.mediaIndex : null;
        const description = this.normalizeSnapshotDescription(entry.analysis);
        if (!mediaIndex || mediaIndex < 1 || !description) return;
        const snap = snaps?.[mediaIndex - 1] as { id?: string; description?: string | null } | undefined;
        if (!snap?.id || (typeof snap.description === 'string' && snap.description.trim())) return;

        const { error: updateError } = await this.supabase
          .from('snapshots')
          .update({ description })
          .eq('id', snap.id);
        if (updateError) console.error('[DualWriter] video description update error:', updateError);
      }));
    } catch (err) {
      console.error('[DualWriter] video description persist error:', err);
    }
  }
}
