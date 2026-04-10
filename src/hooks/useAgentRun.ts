'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
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
  status: 'running' | 'completed' | 'failed'
  prompt: string | null
  started_at: string
  ended_at: string | null
  metadata: Record<string, unknown> | null
}

interface UseAgentRunOptions {
  projectId: string
  enabled: boolean
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
export function useAgentRun({ projectId, enabled }: UseAgentRunOptions): UseAgentRunReturn {
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

  // Check for still-running agent runs on mount
  // Completed runs don't need reconnect — DualWriter already wrote to snapshots/messages tables,
  // so loadProject() will have the complete data.
  useEffect(() => {
    if (!enabled || !projectId) return

    const checkActiveRun = async () => {
      const supabase = getSupabase()

      // Wait for auth session — RLS requires auth.uid()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: runningRun, error } = await supabase
        .from('agent_runs')
        .select('id, status, started_at, metadata')
        .eq('project_id', projectId)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error || !runningRun) return

      // Check if run is stale (started >5 min ago — likely the function died)
      const startedAt = new Date(runningRun.started_at).getTime()
      const fiveMinAgo = Date.now() - 5 * 60 * 1000
      if (startedAt < fiveMinAgo) {
        await supabase.from('agent_runs').update({
          status: 'failed',
          ended_at: new Date().toISOString(),
        }).eq('id', runningRun.id)
        return
      }

      setActiveRunId(runningRun.id)
    }

    checkActiveRun()
  }, [enabled, projectId])

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
      // 1. Get run metadata (firstMessageId) + all events
      const [runRes, eventsRes] = await Promise.all([
        supabase.from('agent_runs').select('metadata').eq('id', activeRunId).single(),
        supabase.from('agent_events').select('*').eq('run_id', activeRunId).order('seq', { ascending: true }),
      ])

      const events = eventsRes.data ?? []
      const metadata = runRes.data?.metadata as Record<string, unknown> | null

      // 2. Collect all messageIds from this run (to remove static loadProject versions)
      const msgIds: string[] = []
      const firstMsgId = metadata?.firstMessageId as string | undefined
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

      // 2. Check if run already completed (could have finished while we were loading)
      const { data: runNow } = await supabase
        .from('agent_runs')
        .select('status')
        .eq('id', activeRunId)
        .single()

      if (runNow?.status === 'completed') {
        callbacks.onDone?.()
        setActiveRunId(null)
        return
      }
      if (runNow?.status === 'failed') {
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
        }, (payload) => {
          const row = payload.new as AgentEventRow
          // Deduplicate: skip if already seen
          if (row.seq <= lastSeenSeq) return
          lastSeenSeq = row.seq
          dispatchEvent(row, callbacks)
        })
        .subscribe()

      channelsRef.current.push(eventsChannel)

      // 4. Subscribe to run status changes
      const runChannel = supabase.channel(`run-status:${activeRunId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_runs',
          filter: `id=eq.${activeRunId}`,
        }, (payload) => {
          const newStatus = (payload.new as AgentRunRow).status
          if (newStatus === 'completed') {
            callbacks.onDone?.()
            disconnect()
          } else if (newStatus === 'failed') {
            callbacks.onError?.('Agent run failed')
            disconnect()
          }
        })
        .subscribe()

      channelsRef.current.push(runChannel)
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
    case 'design': {
      const d = data as { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; snapshotId?: string }
      callbacks.onDesign?.(d)
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
