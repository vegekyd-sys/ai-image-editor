import { getSupabaseAdmin } from '@/lib/supabase/service'
import { PricingUnavailableError } from './media-pricing'

interface ToolPricing {
  tool_name: string
  supplier_cost: number
  credits: number
  is_free: boolean
}

export async function getAllPricing(): Promise<ToolPricing[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('credit_pricing').select('*')
  if (error) throw new PricingUnavailableError('Tool pricing unavailable. Please retry.')
  const pricing = (data ?? []) as ToolPricing[]
  return pricing
}

export async function getToolPrice(toolName: string): Promise<{ credits: number; isFree: boolean } | null> {
  const all = await getAllPricing()
  const entry = all.find(p => p.tool_name === toolName)
  if (!entry) return null
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
  // Kept for callers; prices are read fresh across all server instances.
}
