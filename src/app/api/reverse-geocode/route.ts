import { NextRequest, NextResponse } from 'next/server';
import { reverseGeocode } from '@/lib/image/reverseGeocode';

export async function POST(req: NextRequest) {
  try {
    const { lat, lng } = await req.json();
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ location: null }, { status: 400 });
    }
    const location = await reverseGeocode(lat, lng);
    return NextResponse.json({ location: location ?? null });
  } catch {
    return NextResponse.json({ location: null });
  }
}
