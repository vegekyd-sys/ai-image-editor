'use client'

import { useState, useEffect, useCallback } from 'react'

interface ServiceResult {
  status: 'healthy' | 'unhealthy' | 'unavailable'
  latency?: number
  error?: string
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down'
  timestamp: string
  services: Record<string, ServiceResult>
  summary: { healthy: number; unhealthy: number; unavailable: number }
}

const SERVICE_LABELS: Record<string, string> = {
  supabase_db: 'Supabase Database',
  supabase_auth: 'Supabase Auth',
  supabase_storage: 'Supabase Storage',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  bedrock: 'AWS Bedrock',
  comfyui_qwen: 'ComfyUI Qwen',
  comfyui_pony: 'ComfyUI Pony',
  kling: 'Kling Video',
  piapi: 'PiAPI',
  huggingface: 'HuggingFace',
}

const STATUS_COLORS: Record<string, string> = {
  healthy: '#22c55e',
  unhealthy: '#ef4444',
  unavailable: '#6b7280',
}

const OVERALL_LABELS: Record<string, { text: string; color: string }> = {
  healthy: { text: 'All Systems Operational', color: '#22c55e' },
  degraded: { text: 'Degraded Performance', color: '#f59e0b' },
  down: { text: 'Major Outage', color: '#ef4444' },
}

export default function StatusPage() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<string>('')

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      const json = await res.json()
      setData(json)
      setLastChecked(new Date().toLocaleTimeString())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a0a', color: '#e5e5e5', padding: '24px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Makaron Status</h1>

        {loading && !data ? (
          <p style={{ color: '#888', marginTop: 24 }}>Checking services...</p>
        ) : !data ? (
          <p style={{ color: '#ef4444', marginTop: 24 }}>Failed to fetch health data</p>
        ) : (
          <>
            {/* Overall status banner */}
            <div style={{
              marginTop: 16,
              padding: '16px 20px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${OVERALL_LABELS[data.status]?.color || '#888'}33`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: OVERALL_LABELS[data.status]?.color,
                  boxShadow: `0 0 8px ${OVERALL_LABELS[data.status]?.color}66`,
                }} />
                <span style={{ fontSize: 18, fontWeight: 600 }}>
                  {OVERALL_LABELS[data.status]?.text}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#888' }}>
                {data.summary.healthy} healthy · {data.summary.unhealthy} unhealthy · {data.summary.unavailable} not configured
              </div>
            </div>

            {/* Service list */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(data.services).map(([key, svc]) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: svc.status === 'unhealthy' ? 'rgba(239,68,68,0.08)' : 'transparent',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: STATUS_COLORS[svc.status],
                  }} />
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {SERVICE_LABELS[key] || key}
                  </span>
                  {svc.latency != null && svc.latency > 0 && (
                    <span style={{ fontSize: 12, color: '#888', minWidth: 50, textAlign: 'right' }}>
                      {svc.latency}ms
                    </span>
                  )}
                  {svc.status === 'unhealthy' && svc.error && (
                    <span style={{ fontSize: 11, color: '#ef4444', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.error}
                    </span>
                  )}
                  {svc.status === 'unavailable' && (
                    <span style={{ fontSize: 11, color: '#6b7280' }}>not configured</span>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 24, fontSize: 12, color: '#555', textAlign: 'center' }}>
              Last checked: {lastChecked} · Auto-refresh every 30s
              <br />
              <button
                onClick={() => { setLoading(true); fetchHealth() }}
                style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12 }}
              >
                Check Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
