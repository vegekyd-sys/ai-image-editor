import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentStreamEvent } from './agent';
import { uploadImage } from './supabase/storage';
import { sanitizeToolHistory, type ToolHistoryBudget } from './agentToolHistory';

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
  private sseDisconnected = false;

  // Message accumulation
  private messageText = '';
  private currentMessageId = crypto.randomUUID();
  private currentMessageHasImage = false;
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
  ) {}

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
          await this.supabase.from('snapshots').upsert({
            id: snapshotId,
            project_id: this.projectId,
            image_url: imageUrl,
            tips: [],
            message_id: this.currentMessageId,
            sort_order: sortOrder,
          }, { onConflict: 'id' }).then(({ error }) => {
            if (error) console.error('[DualWriter] snapshot upsert error:', error);
          });
          this.currentMessageHasImage = true;
        } else if (imageUrl) {
          this.currentMessageHasImage = true;
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
          });

          // Upload design JSON to workspace + index in workspace_files for agent read_file
          try {
            const storagePath = `${this.userId}/workspace/${designPath}`;
            await this.supabase.storage.from('images')
              .upload(storagePath, new Blob([designJson], { type: 'application/json' }), { upsert: true });
            const { data: urlData } = this.supabase.storage.from('images').getPublicUrl(storagePath);
            await this.supabase.from('workspace_files').upsert({
              user_id: this.userId,
              path: designPath,
              content_type: 'application/json',
              size_bytes: designJson.length,
              storage_url: urlData?.publicUrl || '',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id,path' });
          } catch (err) {
            console.error('[DualWriter] design upload error:', err);
          }

          // Write snapshots table
          const sortOrder = await this.nextSortOrder();
          await this.supabase.from('snapshots').upsert({
            id: snapId,
            project_id: this.projectId,
            image_url: '',
            tips: [],
            message_id: this.currentMessageId,
            sort_order: sortOrder,
            description: designDesc || '[composition]',
            design_path: designPath,
          }, { onConflict: 'id' }).then(({ error }) => {
            if (error) console.error('[DualWriter] design snapshot upsert error:', error);
          });
          this.currentMessageHasImage = true;

          // Write agent_events
          await this.insertEvent(event.type, {
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation, snapshotId: snapId, published: true,
          });

          // SSE: enriched with snapshotId, normalize type to 'render'
          this.tryEnqueue({ ...event, type: 'render', snapshotId: snapId, published: true });
        } else {
          // Draft design — preview only, no DB snapshot
          await this.insertEvent(event.type, {
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation, published: false,
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
        await this.insertEvent('new_turn', { messageId: this.currentMessageId });
        // SSE: include new messageId
        this.tryEnqueue({ type: 'new_turn', messageId: this.currentMessageId });
        return;
      }

      case 'done': {
        await this.flushContent();
        await this.saveCurrentMessage();
        await this.insertEvent('done', {});
        this.tryEnqueue(event);
        return;
      }

      case 'error': {
        await this.flushContent();
        await this.saveCurrentMessage();

        const { type, ...data } = event as Record<string, unknown>;
        await this.insertEvent('error', data);
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

      case 'animation_task':
      case 'video_snapshot':
      case 'image_analyzed':
      case 'nsfw_detected': {
        await this.flushContent();

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

  /** Call in after() or finally block. */
  async flush() {
    await this.flushContent();
  }

  /** Get the current message ID (for the first message before any new_turn). */
  get firstMessageId() { return this.currentMessageId; }

  /** Save accumulated message text to messages table. */
  private async saveCurrentMessage() {
    if (!this.messageText.trim()) return;
    try {
      await this.supabase.from('messages').upsert({
        id: this.currentMessageId,
        project_id: this.projectId,
        role: 'assistant',
        content: this.messageText,
        has_image: this.currentMessageHasImage,
      }, { onConflict: 'id' });
    } catch (err) {
      console.error('[DualWriter] message upsert error:', err);
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

  private async insertEvent(type: string, data: Record<string, unknown>) {
    try {
      await this.supabase.from('agent_events').insert({
        run_id: this.runId,
        project_id: this.projectId,
        type,
        data,
        seq: this.seq++,
      });
    } catch (err) {
      console.error('[DualWriter] Failed to insert event:', type, err);
    }
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

  private normalizeSnapshotDescription(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.slice(0, 800);
  }

  private async maybePersistVideoAnalysisDescription(input: Record<string, unknown>, output: unknown) {
    const mediaIndex = typeof input.media_index === 'number' ? input.media_index : null;
    if (!mediaIndex || mediaIndex < 1) return;

    const raw = output && typeof output === 'object'
      ? (output as Record<string, unknown>).analysis
      : null;
    const description = this.normalizeSnapshotDescription(raw);
    if (!description) return;

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

      const snap = snaps?.[mediaIndex - 1] as { id?: string; description?: string | null } | undefined;
      if (!snap?.id || (typeof snap.description === 'string' && snap.description.trim())) return;

      const { error: updateError } = await this.supabase
        .from('snapshots')
        .update({ description })
        .eq('id', snap.id);
      if (updateError) console.error('[DualWriter] video description update error:', updateError);
    } catch (err) {
      console.error('[DualWriter] video description persist error:', err);
    }
  }
}
