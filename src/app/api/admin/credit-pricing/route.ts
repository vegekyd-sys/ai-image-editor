import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'

async function checkAdmin(req: Request): Promise<string | null> {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return null
  const ok = await isAdmin(authResult.auth.userId)
  return ok ? authResult.auth.userId : null
}

// GET: list all credit pricing
export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('credit_pricing')
    .select('*')
    .order('tool_name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PUT: update a tool's pricing
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { tool_name, supplier_cost, credits, is_free } = await req.json()
  if (!tool_name) return NextResponse.json({ error: 'tool_name required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('credit_pricing')
    .update({
      ...(supplier_cost !== undefined ? { supplier_cost } : {}),
      ...(credits !== undefined ? { credits } : {}),
      ...(is_free !== undefined ? { is_free } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('tool_name', tool_name)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST: add a new tool pricing entry
export async function POST(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { tool_name, supplier_cost, credits, is_free } = await req.json()
  if (!tool_name) return NextResponse.json({ error: 'tool_name required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('credit_pricing')
    .upsert({ tool_name, supplier_cost: supplier_cost ?? 0, credits: credits ?? 0, is_free: is_free ?? false }, { onConflict: 'tool_name' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE: remove a tool pricing entry
export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { tool_name } = await req.json()
  if (!tool_name) return NextResponse.json({ error: 'tool_name required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('credit_pricing')
    .delete()
    .eq('tool_name', tool_name)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
