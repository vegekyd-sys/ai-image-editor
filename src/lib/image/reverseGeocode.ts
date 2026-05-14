export async function reverseGeocode(lat?: number, lng?: number): Promise<string | undefined> {
  if (lat === undefined || lng === undefined) return undefined;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`,
      {
        headers: { 'User-Agent': 'Makaron-App/1.0', 'Accept': 'application/json' },
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
