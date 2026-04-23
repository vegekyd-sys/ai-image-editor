import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { invalidateTokenRateCache } from '@/lib/billing/token-rates'

const ADMIN_EMAILS = ['vege_kyd@msn.com']

async function checkAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) return null
  return user
}

// GET: list all token rates
export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('token_rates')
    .select('*')
    .order('model_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PUT: update a token rate
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { model_id, display_name, input_per_1m, output_per_1m, markup, is_active } = await req.json()
  if (!model_id) return NextResponse.json({ error: 'model_id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('token_rates')
    .update({
      ...(display_name !== undefined ? { display_name } : {}),
      ...(input_per_1m !== undefined ? { input_per_1m } : {}),
      ...(output_per_1m !== undefined ? { output_per_1m } : {}),
      ...(markup !== undefined ? { markup } : {}),
      ...(is_active !== undefined ? { is_active } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('model_id', model_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateTokenRateCache()
  return NextResponse.json({ success: true })
}

// POST: add a new token rate
export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { model_id, display_name, input_per_1m, output_per_1m, markup } = await req.json()
  if (!model_id || !display_name) {
    return NextResponse.json({ error: 'model_id and display_name required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('token_rates')
    .upsert({
      model_id,
      display_name,
      input_per_1m: input_per_1m ?? 0,
      output_per_1m: output_per_1m ?? 0,
      markup: markup ?? 2.0,
      is_active: true,
    }, { onConflict: 'model_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateTokenRateCache()
  return NextResponse.json({ success: true })
}

// DELETE: remove a token rate
export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { model_id } = await req.json()
  if (!model_id) return NextResponse.json({ error: 'model_id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('token_rates')
    .delete()
    .eq('model_id', model_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateTokenRateCache()
  return NextResponse.json({ success: true })
}
