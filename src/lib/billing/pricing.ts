import { getSupabaseAdmin } from '@/lib/supabase/service'

interface ToolPricing {
  tool_name: string
  supplier_cost: number
  credits: number
  is_free: boolean
}

const DEFAULT_TOOL_PRICING: Record<string, { credits: number; isFree: boolean }> = {
  create_seed_audio: { credits: 10, isFree: false },
  create_voiceover: { credits: 2, isFree: false },
  // GPT Image 2 low-quality generation/edit fallback when the provider does
  // not return token usage. 1 credit = $0.01; includes the standard 2x markup.
  edit_image_openai: { credits: 4, isFree: false },
}

// In-memory cache with TTL
let cache: { data: ToolPricing[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getAllPricing(): Promise<ToolPricing[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data
  const admin = getSupabaseAdmin()
  const { data } = await admin.from('credit_pricing').select('*')
  const pricing = (data ?? []) as ToolPricing[]
  cache = { data: pricing, ts: Date.now() }
  return pricing
}

export async function getToolPrice(toolName: string): Promise<{ credits: number; isFree: boolean } | null> {
  const all = await getAllPricing()
  const entry = all.find(p => p.tool_name === toolName)
  if (!entry) return DEFAULT_TOOL_PRICING[toolName] ?? null
  return { credits: entry.credits, isFree: entry.is_free }
}

/**
 * Map MCP tool name + model to pricing tool_name.
 * e.g. makaron_edit_image + gemini → edit_image_gemini
 */
export function resolveToolName(mcpToolName: string, model?: string): string {
  // Strip makaron_ prefix
  const base = mcpToolName.replace(/^makaron_/, '')
  // For edit_image, append model suffix
  if (base === 'edit_image' && model) {
    return `edit_image_${model}`
  }
  return base
}

/** Invalidate cache (called after admin updates pricing) */
export function invalidatePricingCache() {
  cache = null
}
