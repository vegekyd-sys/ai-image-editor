import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentStreamEvent } from './agent';
import { uploadImage } from './supabase/storage';

/**
 * Dual-writes agent SSE events to:
 * 1. SSE stream (real-time browser display)
 * 2. agent_events table (reconnection/replay)
 * 3. snapshots table (persistent image/design data)
 * 4. messages table (persistent chat history)
 *
 * This ensures data survives browser disconnects — user returns and
 * loadProject() has complete data without needing frontend replay.
 */
export class AgentDualWriter {
  private seq = 0;
  private contentBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sseDisconnected = false;

  // Message accumulation — written to messages table on new_turn/done
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

  /** Write event to SSE stream. Catches disconnect errors silently. */
  tryEnqueue(event: AgentStreamEvent) {
    if (this.sseDisconnected) return;
    try {
      this.controller.enqueue(
        this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    } catch {
      this.sseDisconnected = true;
    }
  }

  /** Write event to DB. Content is batched; other events are immediate. */
  async writeEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case 'content': {
        this.contentBuffer += event.text;
        this.messageText += event.text;
        if (this.contentBuffer.length >= 50) {
          await this.flushContent();
        } else if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => this.flushContent(), 500);
        }
        return;
      }

      // Image: upload server-side, store URL, write snapshots table
      case 'image': {
        await this.flushContent();
        const snapshotId = crypto.randomUUID();
        const filename = `snapshot-${snapshotId}.jpg`;
        const imageUrl = await uploadImage(
          this.supabase, this.userId, this.projectId, filename, event.image,
        );
        if (imageUrl) {
          // Write snapshots table
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
        return;
      }

      // Design: save code to workspace + snapshots table (no poster — client renders later)
      case 'design': {
        await this.flushContent();
        const snapId = crypto.randomUUID();
        const designPath = `code/${snapId}.json`;
        const designJson = JSON.stringify({
          code: event.code,
          width: event.width,
          height: event.height,
          props: event.props,
          animation: event.animation,
        });

        // Upload design JSON to workspace storage
        try {
          const storagePath = `${this.userId}/workspace/${designPath}`;
          await this.supabase.storage.from('images')
            .upload(storagePath, new Blob([designJson], { type: 'application/json' }), { upsert: true });
        } catch (err) {
          console.error('[DualWriter] design upload error:', err);
        }

        // Write snapshots table (image_url empty — poster captured client-side)
        const sortOrder = await this.nextSortOrder();
        await this.supabase.from('snapshots').upsert({
          id: snapId,
          project_id: this.projectId,
          image_url: '',
          tips: [],
          message_id: this.currentMessageId,
          sort_order: sortOrder,
          description: '[run_code design]',
          design_path: designPath,
        }, { onConflict: 'id' }).then(({ error }) => {
          if (error) console.error('[DualWriter] design snapshot upsert error:', error);
        });
        this.currentMessageHasImage = true;

        // Write agent_events
        await this.insertEvent('design', {
          code: event.code,
          width: event.width,
          height: event.height,
          props: event.props,
          animation: event.animation,
          snapshotId: snapId,
        });
        return;
      }

      // Tool call: store but truncate large inputs
      case 'tool_call': {
        await this.flushContent();
        const input = { ...event.input };
        if (typeof input.code === 'string' && input.code.length > 2000) {
          input.code = input.code.slice(0, 2000) + '...(truncated)';
        }
        delete input.image;
        delete input.images;
        await this.insertEvent('tool_call', { tool: event.tool, input });
        return;
      }

      case 'status': {
        await this.flushContent();
        await this.insertEvent('status', { text: event.text });
        return;
      }

      case 'new_turn': {
        await this.flushContent();
        // Save current message before starting a new one
        await this.saveCurrentMessage();
        this.messageText = '';
        this.currentMessageId = crypto.randomUUID();
        this.currentMessageHasImage = false;
        await this.insertEvent('new_turn', {});
        return;
      }

      case 'done': {
        await this.flushContent();
        // Save final message
        await this.saveCurrentMessage();
        await this.insertEvent('done', {});
        return;
      }

      case 'error': {
        await this.flushContent();
        await this.saveCurrentMessage();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type, ...data } = event as Record<string, unknown>;
        await this.insertEvent('error', data);
        return;
      }

      case 'animation_task':
      case 'image_analyzed':
      case 'nsfw_detected': {
        await this.flushContent();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type: _t, ...rest } = event as Record<string, unknown>;
        await this.insertEvent(event.type, rest);
        return;
      }

      default:
        // Unknown event types (reasoning, coding, code_stream): skip DB write
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
    await this.insertEvent('content', { text: this.contentBuffer });
    this.contentBuffer = '';
  }

  /** Call in after() or finally block. */
  async flush() {
    await this.flushContent();
  }

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
      return Date.now(); // fallback: use timestamp as sort order
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
