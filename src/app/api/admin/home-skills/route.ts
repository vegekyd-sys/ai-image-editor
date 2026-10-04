import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { LOCALE_CONFIG } from '@/lib/locales'
import { getSupabaseAdmin } from '@/lib/supabase/service'

type JsonObject = Record<string, unknown>

async function checkAdmin(req: Request): Promise<string | null> {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return null
  const ok = await isAdmin(authResult.auth.userId)
  return ok ? authResult.auth.userId : null
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function sanitizeLocalizedCopy(value: unknown): Record<string, string> {
  const source = asObject(value)
  return Object.fromEntries(
    LOCALE_CONFIG.flatMap(({ code }) => {
      const copy = source[code]
      if (typeof copy !== 'string' || copy.trim().length === 0) return []
      return [[code, copy.trim()]]
    }),
  )
}

function sanitizeStringList(value: unknown, maxItems = 32): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))]
    .slice(0, maxItems)
}

function sanitizeCategories(value: unknown): string[] {
  return sanitizeStringList(value, 32).filter(id => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function firstLocalizedValue(value: Record<string, string>): string {
  return value.en || value.zh || value['zh-Hant'] || value.ja || ''
}

function missingLocales(value: Record<string, string>): string[] {
  return LOCALE_CONFIG
    .map(({ code }) => code)
    .filter(code => !value[code])
}

async function validateCategories(
  admin: ReturnType<typeof getSupabaseAdmin>,
  categories: string[],
): Promise<{ error: string; status: number } | null> {
  if (categories.length === 0) {
    return { error: 'At least one category is required', status: 400 }
  }
  const { data, error } = await admin
    .from('skill_categories')
    .select('id')
    .in('id', categories)
  if (error) return { error: error.message, status: 500 }
  const existingIds = new Set((data || []).map(category => category.id))
  const unknown = categories.filter(category => !existingIds.has(category))
  return unknown.length > 0
    ? { error: `Unknown categories: ${unknown.join(', ')}`, status: 400 }
    : null
}

async function readBody(req: NextRequest): Promise<JsonObject | null> {
  try {
    return asObject(await req.json())
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('home_skills')
    .select('*')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const labels = sanitizeLocalizedCopy(body.labels)
  const image = typeof body.image === 'string' ? body.image.trim() : ''
  const prompts = sanitizeLocalizedCopy(body.prompts)
  const missingTitles = missingLocales(labels)
  const missingPrompts = missingLocales(prompts)
  if (missingTitles.length > 0) {
    return NextResponse.json({ error: `Missing localized titles: ${missingTitles.join(', ')}` }, { status: 400 })
  }
  if (missingPrompts.length > 0) {
    return NextResponse.json({ error: `Missing localized prompts: ${missingPrompts.join(', ')}` }, { status: 400 })
  }
  if (!image) return NextResponse.json({ error: 'image required' }, { status: 400 })

  const categories = sanitizeCategories(body.categories)

  const admin = getSupabaseAdmin()
  const categoryError = await validateCategories(admin, categories)
  if (categoryError) {
    return NextResponse.json({ error: categoryError.error }, { status: categoryError.status })
  }
  const { data, error } = await admin
    .from('home_skills')
    .insert({
      labels,
      image,
      prompts,
      prompt: prompts.en || firstLocalizedValue(prompts),
      categories,
      skill_path: typeof body.skill_path === 'string' && body.skill_path.trim() ? body.skill_path.trim() : null,
      image_count: asInteger(body.image_count, 1, 0, 10),
      sort_order: asInteger(body.sort_order, 0, -100000, 100000),
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
      before_images: sanitizeStringList(body.before_images, 3),
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const updates: JsonObject = {}
  const updatesLocalizedCopy = hasOwn(body, 'labels') || hasOwn(body, 'prompts')
  let existing: { labels?: unknown; prompts?: unknown; prompt?: unknown } | null = null
  if (updatesLocalizedCopy) {
    const { data, error } = await admin
      .from('home_skills')
      .select('labels,prompts,prompt')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    existing = data
  }
  if (hasOwn(body, 'labels')) {
    const labels = sanitizeLocalizedCopy(body.labels)
    if (Object.keys(labels).length === 0) {
      return NextResponse.json({ error: 'At least one localized title is required' }, { status: 400 })
    }
    updates.labels = { ...sanitizeLocalizedCopy(existing?.labels), ...labels }
  }
  if (hasOwn(body, 'image')) {
    const image = typeof body.image === 'string' ? body.image.trim() : ''
    if (!image) return NextResponse.json({ error: 'image required' }, { status: 400 })
    updates.image = image
  }
  if (hasOwn(body, 'prompts')) {
    const prompts = sanitizeLocalizedCopy(body.prompts)
    const legacyPrompt = typeof existing?.prompt === 'string' ? existing.prompt.trim() : ''
    const mergedPrompts = {
      ...(legacyPrompt ? { en: legacyPrompt } : {}),
      ...sanitizeLocalizedCopy(existing?.prompts),
      ...prompts,
    }
    updates.prompts = mergedPrompts
    if (mergedPrompts.en) {
      updates.prompt = mergedPrompts.en
    } else if (hasOwn(body, 'prompt')) {
      updates.prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    }
  } else if (hasOwn(body, 'prompt')) {
    updates.prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  }
  if (hasOwn(body, 'categories')) {
    const categories = sanitizeCategories(body.categories)
    const categoryError = await validateCategories(admin, categories)
    if (categoryError) {
      return NextResponse.json({ error: categoryError.error }, { status: categoryError.status })
    }
    updates.categories = categories
  }
  if (hasOwn(body, 'skill_path')) {
    updates.skill_path = typeof body.skill_path === 'string' && body.skill_path.trim() ? body.skill_path.trim() : null
  }
  if (hasOwn(body, 'image_count')) updates.image_count = asInteger(body.image_count, 1, 0, 10)
  if (hasOwn(body, 'sort_order')) updates.sort_order = asInteger(body.sort_order, 0, -100000, 100000)
  if (hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    updates.is_active = body.is_active
  }
  if (hasOwn(body, 'before_images')) updates.before_images = sanitizeStringList(body.before_images, 3)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { error } = await admin
    .from('home_skills')
    .update(updates)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  const id = body && typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('home_skills')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
