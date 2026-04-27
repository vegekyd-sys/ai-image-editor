import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

const ADMIN_EMAILS = ['vege_kyd@msn.com']

async function checkAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) return null
  return user
}

export async function GET() {
  if (!(await checkAdmin())) {
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
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await req.json()
  const { labels, image, prompt, skill_path, image_count, sort_order, is_active } = body
  if (!labels || !image) {
    return NextResponse.json({ error: 'labels and image required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('home_skills')
    .insert({
      labels,
      image,
      prompt: prompt || '',
      skill_path: skill_path || null,
      image_count: image_count ?? 1,
      sort_order: sort_order ?? 0,
      is_active: is_active ?? true,
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('home_skills')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('home_skills')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
