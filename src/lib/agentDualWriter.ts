import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentStreamEvent } from './agent';
import { uploadImage } from './supabase/storage';

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
  private sseDisconnected = false;

  // Message accumulation
  private messageText = '';
  private currentMessageId = crypto.randomUUID();
  private currentMessageHasImage = false;

  constructor(
    private runId: string,
    private supabase: SupabaseClient,
    private userId: string,
    private projectId: string,
    private controller: ReadableStreamDefaultController,
    private encoder: TextEncoder,
  ) {}

  /** Write enriched event to SSE stream. Catches disconnect errors silently. */
  tryEnqueue(event: Record<string, unknown>) {
    if (this.sseDisconnected) return;
    try {
      this.controller.enqueue(
        this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    } catch {
      this.sseDisconnected = true;
    }
  }

  /**
   * Process event: write to DB, return enriched event for SSE.
   * The enriched event includes server-generated IDs (snapshotId, imageUrl, messageId).
   */
  async processAndEnqueue(event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
      case 'content': {
        this.messageText += event.text;
        // SSE: send immediately
        this.tryEnqueue(event);
        // DB: store each content delta individually (1:1 with SSE for Replay fidelity)
        await this.insertEvent('content', { text: event.text });
        return;
      }

      case 'image': {
        await this.flushContent();
        const snapshotId = crypto.randomUUID();
        const filename = `snapshot-${snapshotId}.jpg`;
        const imageUrl = await uploadImage(
          this.supabase, this.userId, this.projectId, filename, event.image,
        );

        // Write snapshots table
        if (imageUrl) {
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
        }

        // Write agent_events
        await this.insertEvent('image', {
          snapshotId,
          imageUrl: imageUrl ?? undefined,
          usedModel: event.usedModel,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const published = (event as any).published === true;

        if (published) {
          // Published design — create real Snapshot in DB
          const snapId = crypto.randomUUID();
          const designPath = `code/${snapId}.json`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const designDesc = (event as any).description as string | undefined;
          const designJson = JSON.stringify({
            code: event.code, width: event.width, height: event.height,
            props: event.props, animation: event.animation,
          });

          // Upload design JSON to workspace
          try {
            const storagePath = `${this.userId}/workspace/${designPath}`;
            await this.supabase.storage.from('images')
              .upload(storagePath, new Blob([designJson], { type: 'application/json' }), { upsert: true });
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
            description: designDesc || '[design]',
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type, ...data } = event as Record<string, unknown>;
        await this.insertEvent('error', data);
        this.tryEnqueue(event);
        return;
      }

      case 'tool_call': {
        await this.flushContent();
        const input = { ...event.input };
        if (typeof input.code === 'string' && input.code.length > 2000) {
          input.code = input.code.slice(0, 2000) + '...(truncated)';
        }
        delete input.image;
        delete input.images;
        await this.insertEvent('tool_call', { tool: event.tool, input });
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
      case 'image_analyzed':
      case 'nsfw_detected': {
        await this.flushContent();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type: _t, ...rest } = event as Record<string, unknown>;
        await this.insertEvent(event.type, rest);
        this.tryEnqueue(event);
        return;
      }

      default: {
        // ALL events persisted to agent_events (reasoning, coding, code_stream, etc.)
        // This ensures Replay can reconstruct the exact SSE experience
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type: _type, ...rest } = event as Record<string, unknown>;
        await this.insertEvent(event.type, rest);
        this.tryEnqueue(event);
        return;
      }
    }
  }

  /** No-op — content is now written per-delta, not batched. Kept for caller compat. */
  async flushContent() {}

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

  /** Get next sort_order for snapshots in this project. */
  private async nextSortOrder(): Promise<number> {
    try {
      const { data } = await this.supabase
        .from('snapshots')
        .select('sort_order')
        .eq('project_id', this.projectId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.sort_order ?? 0) + 1;
    } catch {
      return Date.now();
    }
  }

  private async insertEvent(type: string, data: Record<string, unknown>) {
    try {
      await this.supabase.from('agent_events').insert({
        run_id: this.runId,
        type,
        data,
        seq: this.seq++,
      });
    } catch (err) {
      console.error('[DualWriter] Failed to insert event:', type, err);
    }
  }
}
