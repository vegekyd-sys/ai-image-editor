import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readFile } from '@/lib/workspace';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const path = req.nextUrl.searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const result = await readFile(path, supabase, userId);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ content: result.content, contentType: result.contentType });
  } catch (err) {
    console.error('[workspace/read]', err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
