import { getSupabaseAdmin } from '@/lib/supabase/service'
import { PricingUnavailableError } from './media-pricing'

interface ToolPricing {
  tool_name: string
  supplier_cost: number
  credits: number
  is_free: boolean
}

/** Separate SKU so a Preview fal rollout never reprices Production's Vast route. */
export const FAL_ROTATE_CAMERA_TOOL = 'rotate_camera_fal'

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
export function resolveToolName(mcpToolName: string, model?: string, imageInputCount?: number): string {
  // Strip makaron_ prefix
  const base = mcpToolName.replace(/^makaron_/, '')
  if (base === 'rotate_camera') return FAL_ROTATE_CAMERA_TOOL
  // For edit_image, append model suffix
  if (base === 'edit_image' && model) {
    if (model === 'qwen-spicy' && imageInputCount !== undefined) {
      if (imageInputCount === 0) return 'generate_image_qwen-spicy'
      if (imageInputCount === 2 || imageInputCount === 3) return `edit_image_qwen-spicy-${imageInputCount}`
      if (imageInputCount !== 1) throw new Error('Qwen Spicy supports 0-3 input images')
    }
    return `edit_image_${model}`
  }
  return base
}

/** Invalidate cache (called after admin updates pricing) */
export function invalidatePricingCache() {
  // Kept for callers; prices are read fresh across all server instances.
}
