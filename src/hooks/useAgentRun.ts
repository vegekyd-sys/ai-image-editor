'use client'

import { useRef, useEffect, useCallback, useState, type RefObject } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import type { AgentStreamCallbacks } from '@/lib/agentStream'

// DB row shape from agent_events table
export interface AgentEventRow {
  id: string
  run_id: string
  type: string
  data: Record<string, unknown>
  seq: number
  created_at: string
}

export interface AgentRunRow {
  id: string
  project_id: string
  user_id: string
  status: 'running' | 'completed' | 'failed' | 'aborted'
  prompt: string | null
  started_at: string
  ended_at: string | null
  metadata: Record<string, unknown> | null
}

type AgentRunStatus = AgentRunRow['status'] | 'in_progress' | 'queued'

interface AgentRunApiResponse {
  status: AgentRunStatus
  first_message_id?: string
  events?: AgentEventRow[]
}

interface UseAgentRunOptions {
  projectId: string
  enabled: boolean
  skipRunIdRef?: RefObject<string | null>
  isActiveRef?: RefObject<boolean>
}

interface UseAgentRunReturn {
  /** ID of the active run being reconnected to, or null */
  activeRunId: string | null
  /** All DualWriter messageIds for the active run (for removing static loadProject messages) */
  runMessageIds: string[]
  /** Whether we're currently replaying historical events */
  isReconnecting: boolean
  /** Call this to start reconnecting with the provided callbacks */
  reconnect: (callbacks: AgentStreamCallbacks) => Promise<void>
  /** Disconnect realtime subscriptions */
  disconnect: () => void
}

/**
 * Detects active agent runs on project load and provides reconnection.
 *
 * Flow:
 * 1. On mount, queries for a running agent_run for this project
 * 2. If found, `activeRunId` is set — Editor should call `reconnect(callbacks)`
 * 3. reconnect() replays historical events then subscribes to Realtime for new ones
 * 4. When run completes (status change), automatically unsubscribes
 */
export function useAgentRun({ projectId, enabled, skipRunIdRef, isActiveRef }: UseAgentRunOptions): UseAgentRunReturn {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const channelsRef = useRef<RealtimeChannel[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runMessageIds, setRunMessageIds] = useState<string[]>([])
  const [isReconnecting, setIsReconnecting] = useState(false)

  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  // Persistent watcher: polls /api/agent/poll to detect running agent runs
  useEffect(() => {
    if (!enabled || !projectId) return
    if (activeRunId) return

    const poll = async () => {
      if (isActiveRef?.current) return
      if (skipRunIdRef?.current) return

      try {
        const res = await fetch(`/api/agent/poll?projectId=${projectId}`)
        if (!res.ok) return

        const run = await res.json() as { id: string; started_at: string } | null
        if (!run) return
        if (run.id === skipRunIdRef?.current) return
        if (Date.now() - new Date(run.started_at).getTime() > 800_000) return

        setActiveRunId(run.id)
      } catch { /* polling is best-effort */ }
    }

    poll()
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, activeRunId])

  const disconnect = useCallback(() => {
    for (const ch of channelsRef.current) {
      ch.unsubscribe()
    }
    channelsRef.current = []
    setActiveRunId(null)
    setIsReconnecting(false)
  }, [])

  const reconnect = useCallback(async (callbacks: AgentStreamCallbacks) => {
    if (!activeRunId) return
    const supabase = getSupabase()
    setIsReconnecting(true)

    try {
      const fetchRunEvents = async (afterSeq?: number): Promise<AgentRunApiResponse> => {
        const params = new URLSearchParams({ events: 'true' })
        if (afterSeq !== undefined) params.set('after', String(afterSeq))
        const res = await fetch(`/api/agent/run/${activeRunId}?${params.toString()}`)
        if (!res.ok) throw new Error(`agent run fetch failed: ${res.status}`)
        return res.json() as Promise<AgentRunApiResponse>
      }

      // 1. Get run metadata (firstMessageId) + all events through the API.
      // Public project viewers cannot read agent_events directly because RLS stays owner-only.
      const initialRun = await fetchRunEvents()
      const events = initialRun.events ?? []

      // 2. Collect all messageIds from this run (to remove static loadProject versions)
      const msgIds: string[] = []
      const firstMsgId = initialRun.first_message_id
      if (firstMsgId) msgIds.push(firstMsgId)
      for (const ev of events) {
        if (ev.type === 'new_turn' && (ev.data as Record<string, unknown>)?.messageId) {
          msgIds.push((ev.data as Record<string, unknown>).messageId as string)
        }
      }
      setRunMessageIds(msgIds)

      // 3. Tell Editor to remove static messages from this run (onClearRunMessages callback)
      callbacks.onClearRunMessages?.(msgIds)

      // 4. Replay all events — rebuilds messages from agent_events (single source of truth)
      let lastSeenSeq = -1
      if (events.length) {
        // Set first messageId before replaying content events
        if (firstMsgId) callbacks.onNewTurn?.(firstMsgId)
        for (const row of events) {
          dispatchEvent(row as AgentEventRow, callbacks)
          lastSeenSeq = row.seq
        }
      }

      setIsReconnecting(false)

      // Helper: fetch and replay any events we missed (gap between lastSeenSeq and DB)
      const catchUpMissedEvents = async (): Promise<AgentRunStatus | undefined> => {
        const latestRun = await fetchRunEvents(lastSeenSeq)
        const missed = latestRun.events ?? []
        if (missed?.length) {
          for (const ev of missed) {
            if (ev.seq <= lastSeenSeq) continue
            lastSeenSeq = ev.seq
            dispatchEvent(ev as AgentEventRow, callbacks)
          }
        }
        return latestRun.status
      }

      // 2. Check if run already completed (could have finished while we were loading)
      if (initialRun.status === 'completed' || initialRun.status === 'aborted') {
        await catchUpMissedEvents()
        callbacks.onDone?.()
        setActiveRunId(null)
        return
      }
      if (initialRun.status === 'failed') {
        await catchUpMissedEvents()
        callbacks.onError?.('Agent run failed')
        setActiveRunId(null)
        return
      }

      // 3. Subscribe to new events via Realtime
      const eventsChannel = supabase.channel(`run-events:${activeRunId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_events',
          filter: `run_id=eq.${activeRunId}`,
        }, async (payload) => {
          const row = payload.new as AgentEventRow
          if (row.seq <= lastSeenSeq) return

          if (row.type === 'done' || row.type === 'error') {
            // Before processing done/error, catch up any missed events
            await catchUpMissedEvents()
            dispatchEvent(row, callbacks)
            return
          }

          // Normal event — but check for gaps (missed events)
          if (row.seq > lastSeenSeq + 1) {
            // Gap detected — fetch missed events from DB
            await catchUpMissedEvents()
          } else {
            lastSeenSeq = row.seq
            dispatchEvent(row, callbacks)
          }
        })
        .subscribe()

      channelsRef.current.push(eventsChannel)

      // 4. Subscribe to run status changes (backup for done)
      const runChannel = supabase.channel(`run-status:${activeRunId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_runs',
          filter: `id=eq.${activeRunId}`,
        }, async (payload) => {
          const newStatus = (payload.new as AgentRunRow).status
          if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'aborted') {
            // Catch up ALL remaining events before signaling done
            await catchUpMissedEvents()
            if (newStatus === 'completed') callbacks.onDone?.()
            else callbacks.onError?.('Agent run failed')
            disconnect()
          }
        })
        .subscribe()

      channelsRef.current.push(runChannel)

      // 5. Polling — primary mechanism for catching up events (Realtime is unreliable on Nano plan)
      const pollTimer = setInterval(async () => {
        try {
          // Always catch up missed events (not just on completion)
          const status = await catchUpMissedEvents()
          if (status === 'completed' || status === 'failed' || status === 'aborted') {
            clearInterval(pollTimer)
            await catchUpMissedEvents() // final catch-up
            if (status === 'completed') callbacks.onDone?.()
            else callbacks.onError?.('Agent run failed')
            disconnect()
          }
        } catch { /* polling is best-effort */ }
      }, 2000)

      // Store poll timer for cleanup
      channelsRef.current.push({ unsubscribe: () => clearInterval(pollTimer) } as unknown as RealtimeChannel)
    } catch (err) {
      console.error('[useAgentRun] reconnect error:', err)
      setIsReconnecting(false)
      callbacks.onError?.('Failed to reconnect to agent run')
    }
  }, [activeRunId, disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const ch of channelsRef.current) {
        ch.unsubscribe()
      }
      channelsRef.current = []
    }
  }, [])

  return { activeRunId, runMessageIds, isReconnecting, reconnect, disconnect }
}

/**
 * Dispatch a DB event row to the appropriate callback.
 * Maps DB event types back to the AgentStreamCallbacks interface.
 */
function dispatchEvent(row: AgentEventRow, callbacks: AgentStreamCallbacks) {
  const { type, data } = row

  switch (type) {
    case 'content':
      callbacks.onContent?.((data as { text: string }).text)
      break
    case 'new_turn':
      callbacks.onNewTurn?.((data as { messageId?: string }).messageId)
      break
    case 'image': {
      const imgData = data as { imageUrl?: string; snapshotId?: string; usedModel?: string }
      callbacks.onImage?.(
        imgData.imageUrl ?? '',
        imgData.usedModel,
        imgData.snapshotId,
        imgData.imageUrl,
      )
      break
    }
    case 'design': // backward compat — fall through to 'render'
    case 'render': {
      const d = data as { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; snapshotId?: string }
      callbacks.onRender?.(d)
      break
    }
    case 'tool_call':
      callbacks.onToolCall?.(
        (data as { tool: string }).tool,
        (data as { input: Record<string, unknown> }).input ?? {},
      )
      break
    case 'animation_task':
      callbacks.onAnimationTask?.(
        (data as { taskId: string }).taskId,
        (data as { prompt: string }).prompt ?? '',
      )
      break
    case 'video_snapshot': {
      const video = data as { snapshotId?: string; taskId?: string; videoMeta?: import('@/types').VideoMeta }
      if (video.snapshotId && video.taskId && video.videoMeta) {
        callbacks.onVideoSnapshot?.(video.snapshotId, video.taskId, video.videoMeta)
      }
      break
    }
    case 'image_analyzed':
      callbacks.onImageAnalyzed?.((data as { imageIndex: number }).imageIndex)
      break
    case 'nsfw_detected':
      callbacks.onNsfwDetected?.()
      break
    case 'status':
      callbacks.onStatus?.((data as { text: string }).text)
      break
    case 'done':
      callbacks.onDone?.()
      break
    case 'error':
      callbacks.onError?.((data as { message: string }).message)
      break
  }
}
