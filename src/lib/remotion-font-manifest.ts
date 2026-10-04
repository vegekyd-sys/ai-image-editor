import { remotionFontManifestUrlFromServeUrl } from '@/remotion/font-catalog';

function cleanEnv(value: string | undefined): string | undefined {
  const clean = value?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim();
  return clean || undefined;
}

export function resolveRemotionFontManifestUrl(serveUrl?: string): string {
  const explicit = cleanEnv(process.env.REMOTION_FONT_MANIFEST_URL);
  if (explicit) return explicit;

  const resolvedServeUrl = cleanEnv(serveUrl) || cleanEnv(process.env.REMOTION_LAMBDA_SERVE_URL);
  if (!resolvedServeUrl) {
    throw new Error('REMOTION_FONT_MANIFEST_URL or REMOTION_LAMBDA_SERVE_URL is required');
  }
  return remotionFontManifestUrlFromServeUrl(resolvedServeUrl);
}
