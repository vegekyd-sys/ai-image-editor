import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildPhotoMetadata, extractPhotoMetadataCore } from '@/lib/image/metadataShared';

async function reverseGeocode(lat?: number, lng?: number): Promise<string | undefined> {
  if (lat === undefined || lng === undefined) return undefined;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`,
      {
        headers: {
          'User-Agent': 'Makaron-App/1.0',
          'Accept': 'application/json',
        },
        cache: 'no-store',
      },
    );
    if (!res.ok) return undefined;

    const geo = await res.json();
    const addr = geo?.address;
    if (!addr || typeof addr !== 'object') return undefined;
    const city = addr.city || addr.town || addr.village || addr.county;
    const country = addr.country;
    return [city, country].filter(Boolean).join(', ') || undefined;
  } catch {
    return undefined;
  }
}

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
