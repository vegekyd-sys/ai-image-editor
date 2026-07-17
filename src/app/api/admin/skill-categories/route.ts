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

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim().toLowerCase()
  if (id === 'all' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null
  return id
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(100000, Math.max(-100000, parsed))
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
    .from('skill_categories')
    .select('*')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const id = sanitizeId(body.id)
  const labels = sanitizeLocalizedCopy(body.labels)
  if (!id || Object.keys(labels).length === 0) {
    return NextResponse.json({ error: 'A valid id and at least one localized title are required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('skill_categories')
    .insert({
      id,
      labels,
      descriptions: sanitizeLocalizedCopy(body.descriptions),
      icon: typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 32) : null,
      sort_order: asInteger(body.sort_order, 0),
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
    })
    .select('*')
    .single()
  if (error) {
    const status = error.code === '23505' ? 409 : 500
    return NextResponse.json({ error: error.code === '23505' ? 'Category id already exists' : error.message }, { status })
  }
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const id = sanitizeId(body.id)
  if (!id) return NextResponse.json({ error: 'Valid id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const updates: JsonObject = {}
  const updatesLocalizedCopy = hasOwn(body, 'labels') || hasOwn(body, 'descriptions')
  let existing: { labels?: unknown; descriptions?: unknown } | null = null
  if (updatesLocalizedCopy) {
    const { data, error } = await admin
      .from('skill_categories')
      .select('labels,descriptions')
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
  if (hasOwn(body, 'descriptions')) {
    updates.descriptions = {
      ...sanitizeLocalizedCopy(existing?.descriptions),
      ...sanitizeLocalizedCopy(body.descriptions),
    }
  }
  if (hasOwn(body, 'icon')) {
    updates.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 32) : null
  }
  if (hasOwn(body, 'sort_order')) updates.sort_order = asInteger(body.sort_order, 0)
  if (hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    updates.is_active = body.is_active
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from('skill_categories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await readBody(req)
  const id = body ? sanitizeId(body.id) : null
  if (!id) return NextResponse.json({ error: 'Valid id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data: assigned, error: assignedError } = await admin
    .from('home_skills')
    .select('id')
    .contains('categories', [id])
    .limit(1)
  if (assignedError) return NextResponse.json({ error: assignedError.message }, { status: 500 })
  if (assigned && assigned.length > 0) {
    return NextResponse.json({ error: 'Remove this category from its skills before deleting it' }, { status: 409 })
  }

  const { error } = await admin
    .from('skill_categories')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
