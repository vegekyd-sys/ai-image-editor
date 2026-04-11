import type { AgentEventRow } from '@/hooks/useAgentRun'
import type { Message, Snapshot } from '@/types'

export interface ReplayState {
  messages: Message[]
  snapshots: Snapshot[]
  currentStatus: string
  /** Which tool is currently being called (for UI display) */
  activeToolCall: string | null
}

export interface ReplayCallbacks {
  onStateChange: (state: ReplayState) => void
  onComplete: () => void
}

/**
 * Replays agent events with timing, simulating the creation process.
 *
 * Events are played in sequence with delays derived from their timestamps.
 * Speed multiplier and max delay cap keep the experience snappy.
 */
export class ReplayEngine {
  private events: AgentEventRow[]
  private currentIndex = 0
  private state: ReplayState
  private speed = 1
  private _isPlaying = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private callbacks: ReplayCallbacks
  private currentMsgId: string | null = null

  constructor(events: AgentEventRow[], callbacks: ReplayCallbacks) {
    this.events = events.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.seq - b.seq,
    )
    this.state = {
      messages: [],
      snapshots: [],
      currentStatus: '',
      activeToolCall: null,
    }
    this.callbacks = callbacks
  }

  get isPlaying() { return this._isPlaying }
  get progress() { return { current: this.currentIndex, total: this.events.length } }
  get currentSpeed() { return this.speed }

  play() {
    this._isPlaying = true
    this.scheduleNext()
  }

  pause() {
    this._isPlaying = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  /** Seek to a specific event index — replays all events up to that point instantly. */
  seekTo(index: number) {
    // Reset state
    this.state = {
      messages: [],
      snapshots: [],
      currentStatus: '',
      activeToolCall: null,
    }
    this.currentMsgId = null
    this.currentIndex = 0

    // Replay up to target instantly
    const target = Math.min(index, this.events.length)
    for (let i = 0; i < target; i++) {
      this.applyEvent(this.events[i])
      this.currentIndex = i + 1
    }

    this.callbacks.onStateChange({ ...this.state })

    // Continue playing from this point if was playing
    if (this._isPlaying) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.scheduleNext()
    }
  }

  destroy() {
    this.pause()
  }

  private scheduleNext() {
    if (this.currentIndex >= this.events.length) {
      this._isPlaying = false
      this.callbacks.onComplete()
      return
    }

    const current = this.events[this.currentIndex]
    this.applyEvent(current)
    this.callbacks.onStateChange({ ...this.state })
    this.currentIndex++

    if (!this._isPlaying || this.currentIndex >= this.events.length) {
      if (this.currentIndex >= this.events.length) {
        this._isPlaying = false
        this.callbacks.onComplete()
      }
      return
    }

    const next = this.events[this.currentIndex]
    const rawDelay = new Date(next.created_at).getTime() - new Date(current.created_at).getTime()

    // Content events should flow fast (typing effect)
    const maxDelay = current.type === 'content' ? 80 : 3000
    const delay = Math.min(Math.max(rawDelay / this.speed, 16), maxDelay)

    this.timer = setTimeout(() => {
      this.timer = null
      this.scheduleNext()
    }, delay)
  }

  private applyEvent(event: AgentEventRow) {
    const { type, data } = event

    switch (type) {
      case 'content': {
        const text = (data as { text: string }).text ?? ''
        if (this.currentMsgId) {
          this.state.messages = this.state.messages.map(m =>
            m.id === this.currentMsgId ? { ...m, content: m.content + text } : m,
          )
        } else {
          // First content event — create a message
          const id = `replay-${event.seq}`
          this.currentMsgId = id
          this.state.messages = [...this.state.messages, {
            id,
            role: 'assistant' as const,
            content: text,
            timestamp: new Date(event.created_at).getTime(),
          }]
        }
        break
      }

      case 'new_turn': {
        const id = `replay-${event.seq}`
        this.currentMsgId = id
        this.state.messages = [...this.state.messages, {
          id,
          role: 'assistant' as const,
          content: '',
          timestamp: new Date(event.created_at).getTime(),
        }]
        break
      }

      case 'image': {
        const { imageUrl, snapshotId } = data as { imageUrl?: string; snapshotId?: string }
        if (imageUrl) {
          const snapId = snapshotId || `replay-snap-${event.seq}`
          this.state.snapshots = [...this.state.snapshots, {
            id: snapId,
            image: imageUrl,
            imageUrl,
            tips: [],
            messageId: this.currentMsgId || '',
          }]
        }
        this.state.activeToolCall = null
        break
      }

      case 'tool_call': {
        const tool = (data as { tool: string }).tool
        this.state.activeToolCall = tool
        break
      }

      case 'status': {
        this.state.currentStatus = (data as { text: string }).text ?? ''
        break
      }

      case 'done':
      case 'error':
        this.state.activeToolCall = null
        this.state.currentStatus = type === 'done' ? 'Done' : (data as { message?: string }).message || 'Error'
        break

      // Other event types (animation_task, image_analyzed, nsfw_detected, code_complete) — skip for replay display
    }
  }
}

/**
 * Load all replay events for a project from Supabase.
 */
export async function loadReplayEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
): Promise<AgentEventRow[]> {
  // Get all runs for this project
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('project_id', projectId)
    .order('started_at', { ascending: true })

  if (!runs?.length) return []

  const runIds = runs.map((r: { id: string }) => r.id)

  // Get all events for all runs
  const { data: events } = await supabase
    .from('agent_events')
    .select('*')
    .in('run_id', runIds)
    .order('created_at', { ascending: true })

  return (events ?? []) as AgentEventRow[]
}
