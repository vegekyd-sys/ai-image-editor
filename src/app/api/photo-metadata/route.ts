import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildPhotoMetadata, extractPhotoMetadataCore } from '@/lib/image/metadataShared';
import { reverseGeocode } from '@/lib/image/reverseGeocode';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const exifr = (await import('exifr')).default;
    const exif = await exifr.parse(Buffer.from(await file.arrayBuffer()), {
      gps: true,
      reviveValues: false,
    });
    const core = extractPhotoMetadataCore(exif);
    if (!core) {
      return NextResponse.json({ metadata: null });
    }

    const location = await reverseGeocode(core.lat, core.lng);
    return NextResponse.json({ metadata: buildPhotoMetadata(core, location) ?? null });
  } catch (error) {
    console.error('Photo metadata extraction error:', error);
    return NextResponse.json({ metadata: null }, { status: 200 });
  }
}
