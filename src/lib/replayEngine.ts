import type { AgentEventRow } from '@/hooks/useAgentRun'
import type { Message, Snapshot, ProjectAnimation } from '@/types'

export interface ProjectState {
  snapshots: Snapshot[]
  messages: Message[]
  title: string
  animations: ProjectAnimation[]
}

export interface ReplayCallbacks {
  onStateChange: (state: ProjectState) => void
  onComplete: () => void
}

/**
 * Unified project state builder from agent_events.
 *
 * Two modes:
 * - `buildState(events)`: instant — processes all events synchronously, returns final state
 * - `new ReplayEngine(events).play()`: playback — processes events with timing for animation
 */
export class ReplayEngine {
  private events: AgentEventRow[]
  private currentIndex = 0
  private state: ProjectState
  private speed = 1
  private _isPlaying = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private callbacks: ReplayCallbacks
  private currentMsgId: string | null = null

  // ── Static: Instant mode (替代 loadProject) ──

  /**
   * Build complete project state from events in one pass.
   * Handles parallel runs correctly by processing each run's events
   * in sequence (grouped by run_id), then merging results by timestamp.
   */
  static buildState(events: AgentEventRow[]): ProjectState {
    // Group events by run_id (null run_id = user events, processed separately)
    const runGroups = new Map<string, AgentEventRow[]>()
    const userEvents: AgentEventRow[] = []

    for (const event of events) {
      if (!event.run_id) {
        userEvents.push(event)
      } else {
        const group = runGroups.get(event.run_id) || []
        group.push(event)
        runGroups.set(event.run_id, group)
      }
    }

    // Process each run independently (no cross-run currentMsgId contamination)
    const state: ProjectState = {
      snapshots: [],
      messages: [],
      title: 'Untitled',
      animations: [],
    }

    // 1. Process user events first (image_upload, user_message, project_named, etc.)
    userEvents.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    let userMsgId: string | null = null
    for (const event of userEvents) {
      ReplayEngine.applyEvent(event, state, userMsgId, (id) => { userMsgId = id })
    }

    // 2. Process each agent run in chronological order (by run start time)
    const sortedRuns = [...runGroups.entries()].sort((a, b) => {
      const aFirst = a[1][0]?.created_at ?? ''
      const bFirst = b[1][0]?.created_at ?? ''
      return aFirst.localeCompare(bFirst)
    })

    for (const [, runEvents] of sortedRuns) {
      // Sort within run by seq (not created_at — seq is the authoritative order within a run)
      runEvents.sort((a, b) => a.seq - b.seq)
      let runMsgId: string | null = null
      for (const event of runEvents) {
        ReplayEngine.applyEvent(event, state, runMsgId, (id) => { runMsgId = id })
      }
    }

    // 3. Sort messages by timestamp for correct CUI display order
    state.messages.sort((a, b) => a.timestamp - b.timestamp)

    return state
  }

  // ── Instance: Playback mode (回放动画) ──

  constructor(events: AgentEventRow[], callbacks: ReplayCallbacks) {
    this.events = [...events].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.seq - b.seq,
    )
    this.state = { snapshots: [], messages: [], title: 'Untitled', animations: [] }
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

  setSpeed(speed: number) { this.speed = speed }

  seekTo(index: number) {
    this.state = { snapshots: [], messages: [], title: 'Untitled', animations: [] }
    this.currentMsgId = null
    this.currentIndex = 0

    const target = Math.min(index, this.events.length)
    for (let i = 0; i < target; i++) {
      ReplayEngine.applyEvent(this.events[i], this.state, this.currentMsgId, (id) => { this.currentMsgId = id })
      this.currentIndex = i + 1
    }
    this.callbacks.onStateChange({ ...this.state })

    if (this._isPlaying) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.scheduleNext()
    }
  }

  destroy() { this.pause() }

  private scheduleNext() {
    if (this.currentIndex >= this.events.length) {
      this._isPlaying = false
      this.callbacks.onComplete()
      return
    }

    const current = this.events[this.currentIndex]
    ReplayEngine.applyEvent(current, this.state, this.currentMsgId, (id) => { this.currentMsgId = id })
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

    // Content/code_stream: fast typing effect; reasoning/coding: skip quickly; others: cap at 3s
    let maxDelay = 3000
    if (current.type === 'content' || current.type === 'code_stream') maxDelay = 50
    else if (current.type === 'reasoning' || current.type === 'coding' || current.type === 'status') maxDelay = 200

    const delay = Math.min(Math.max(rawDelay / this.speed, 16), maxDelay)
    this.timer = setTimeout(() => { this.timer = null; this.scheduleNext() }, delay)
  }

  // ── Shared: Event → State reducer ──

  private static applyEvent(
    event: AgentEventRow,
    state: ProjectState,
    currentMsgId: string | null,
    setMsgId: (id: string) => void,
  ) {
    const { type, data } = event
    const d = data as Record<string, unknown>

    switch (type) {
      // ── Agent chat events ──

      case 'content': {
        const text = (d.text as string) ?? ''
        if (currentMsgId) {
          state.messages = state.messages.map(m =>
            m.id === currentMsgId ? { ...m, content: m.content + text } : m,
          )
        }
        break
      }

      case 'new_turn': {
        const id = (d.messageId as string) || `replay-${event.seq}`
        setMsgId(id)
        state.messages = [...state.messages, {
          id,
          role: 'assistant' as const,
          content: '',
          timestamp: new Date(event.created_at).getTime(),
        }]
        break
      }

      case 'image': {
        const imageUrl = d.imageUrl as string | undefined
        const snapshotId = d.snapshotId as string | undefined
        if (imageUrl) {
          const snapId = snapshotId || `replay-snap-${event.seq}`
          // Deduplicate
          if (!state.snapshots.some(s => s.id === snapId)) {
            state.snapshots = [...state.snapshots, {
              id: snapId,
              image: imageUrl,
              imageUrl,
              tips: [],
              messageId: currentMsgId || '',
            }]
          }
          // Set inline image on current message
          if (currentMsgId) {
            state.messages = state.messages.map(m =>
              m.id === currentMsgId ? { ...m, image: imageUrl } : m,
            )
          }
        }
        break
      }

      case 'render':
      case 'design': {
        const code = d.code as string
        const snapshotId = d.snapshotId as string | undefined
        const published = d.published as boolean | undefined
        if (code && published !== false) {
          const snapId = snapshotId || `replay-design-${event.seq}`
          if (!state.snapshots.some(s => s.id === snapId)) {
            state.snapshots = [...state.snapshots, {
              id: snapId,
              image: '', // poster captured client-side
              tips: [],
              messageId: currentMsgId || '',
              description: '[run_code design]',
              design: {
                code,
                width: (d.width as number) || 1080,
                height: (d.height as number) || 1350,
                props: d.props as Record<string, unknown> | undefined,
                animation: d.animation as { fps: number; durationInSeconds: number; format?: string } | undefined,
              },
            }]
          }
        }
        break
      }

      case 'code_stream': {
        // Append code to current message (like CUI streaming)
        const text = (d.text as string) ?? ''
        const done = d.done as boolean
        if (currentMsgId) {
          if (text && !done) {
            // Check if we need to start a code block
            const msg = state.messages.find(m => m.id === currentMsgId)
            if (msg && !msg.content.includes('```javascript')) {
              state.messages = state.messages.map(m =>
                m.id === currentMsgId ? { ...m, content: m.content + '\n\n```javascript\n' + text } : m,
              )
            } else {
              state.messages = state.messages.map(m =>
                m.id === currentMsgId ? { ...m, content: m.content + text } : m,
              )
            }
          } else if (done) {
            state.messages = state.messages.map(m =>
              m.id === currentMsgId ? { ...m, content: m.content + '\n```\n' } : m,
            )
          }
        }
        break
      }

      case 'tool_call':
      case 'status':
      case 'reasoning':
      case 'coding':
      case 'image_analyzed':
      case 'nsfw_detected':
      case 'done':
      case 'error':
        // These don't produce visible state for buildState (instant mode).
        // Playback mode can use them for UI indicators.
        break

      case 'animation_task': {
        const taskId = d.taskId as string
        const prompt = (d.prompt as string) ?? ''
        state.animations = [...state.animations, {
          id: taskId,
          projectId: (d.projectId as string) ?? '',
          taskId,
          videoUrl: null,
          prompt,
          snapshotUrls: [],
          status: 'processing',
          createdAt: event.created_at,
        }]
        break
      }

      // ── User action events (from projectEventLogger) ──

      case 'user_message': {
        const messageId = (d.messageId as string) || `user-${event.seq}`
        const content = (d.content as string) ?? ''
        state.messages = [...state.messages, {
          id: messageId,
          role: 'user' as const,
          content,
          timestamp: new Date(event.created_at).getTime(),
        }]
        break
      }

      case 'image_upload': {
        const snapshotId = d.snapshotId as string
        const imageUrl = d.imageUrl as string
        if (snapshotId && imageUrl && !state.snapshots.some(s => s.id === snapshotId)) {
          state.snapshots = [...state.snapshots, {
            id: snapshotId,
            image: imageUrl,
            imageUrl,
            tips: [],
            messageId: '',
          }]
        }
        break
      }

      case 'tips_generated': {
        const snapshotId = d.snapshotId as string
        const tips = d.tips as unknown[]
        if (snapshotId && tips) {
          state.snapshots = state.snapshots.map(s =>
            s.id === snapshotId ? { ...s, tips: tips as Snapshot['tips'] } : s,
          )
        }
        break
      }

      case 'tip_committed': {
        const newSnapshotId = d.newSnapshotId as string
        const imageUrl = d.imageUrl as string
        if (newSnapshotId && imageUrl && !state.snapshots.some(s => s.id === newSnapshotId)) {
          state.snapshots = [...state.snapshots, {
            id: newSnapshotId,
            image: imageUrl,
            imageUrl,
            tips: [],
            messageId: '',
          }]
        }
        break
      }

      case 'project_named': {
        const title = d.title as string
        if (title) state.title = title
        break
      }

      case 'video_completed': {
        const animId = d.animationId as string
        const videoUrl = d.videoUrl as string
        if (animId && videoUrl) {
          state.animations = state.animations.map(a =>
            a.id === animId ? { ...a, videoUrl, status: 'completed' as const } : a,
          )
        }
        break
      }

      case 'description_set': {
        const snapshotId = d.snapshotId as string
        const description = d.description as string
        if (snapshotId && description) {
          state.snapshots = state.snapshots.map(s =>
            s.id === snapshotId ? { ...s, description } : s,
          )
        }
        break
      }
    }
  }
}

/**
 * Load all events for a project from Supabase.
 * Uses project_id directly (covers both agent events and user events).
 * Paginates to bypass Supabase's default 1000 row limit.
 */
export async function loadReplayEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
): Promise<AgentEventRow[]> {
  const PAGE_SIZE = 1000
  const allEvents: AgentEventRow[] = []
  let offset = 0

  while (true) {
    const { data } = await supabase
      .from('agent_events')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (!data?.length) break
    allEvents.push(...(data as AgentEventRow[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allEvents
}
