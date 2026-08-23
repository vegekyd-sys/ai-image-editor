import { getAvailableFonts } from '@remotion/google-fonts';
import { collectRemotionFontFamilyCandidates, REMOTION_FONT_CATALOG } from '@/remotion/font-catalog';
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';
import { provisionRemotionFontFamilies } from '@/lib/remotion-font-provision';

interface FontDesignInput {
  code: string;
  props?: Record<string, unknown>;
  substitutions?: Record<string, string>;
}

const pendingManifests = new Map<string, Promise<string>>();
const MAX_DYNAMIC_GOOGLE_FONTS_PER_DESIGN = 12;
const GOOGLE_FONT_NAME_BY_LOWERCASE = new Map(
  getAvailableFonts().map((font) => [font.fontFamily.toLowerCase(), font.fontFamily]),
);

function readEnv(name: string): string | undefined {
  const clean = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim();
  return clean || undefined;
}

function inferBucketName(url: string): string {
  const hostname = new URL(url).hostname;
  const virtualHosted = hostname.match(/^(.+?)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i);
  if (virtualHosted?.[1]) return virtualHosted[1];
  throw new Error(
    'REMOTION_LAMBDA_BUCKET_NAME is required when the font manifest is not on a virtual-hosted S3 URL',
  );
}

export function discoverGoogleFontFamilies(input: FontDesignInput): string[] {
  const families = collectRemotionFontFamilyCandidates({
    code: input.code,
    props: input.props,
    substitutions: input.substitutions,
  })
    .map((candidate) => GOOGLE_FONT_NAME_BY_LOWERCASE.get(candidate.trim().toLowerCase()))
    .filter((family): family is string => Boolean(family));
  return [...new Set(families)].sort((a, b) => a.localeCompare(b));
}

export async function resolveRemotionFontManifestUrlForDesign(
  input: FontDesignInput & { serveUrl?: string },
): Promise<string> {
  const baseManifestUrl = resolveRemotionFontManifestUrl(input.serveUrl);
  const requestedFamilies = discoverGoogleFontFamilies(input);
  const baseFamilies = new Set(REMOTION_FONT_CATALOG.map(({ family }) => family.toLowerCase()));
  const dynamicFamilies = requestedFamilies.filter((family) => !baseFamilies.has(family.toLowerCase()));
  if (dynamicFamilies.length === 0) return baseManifestUrl;
  if (dynamicFamilies.length > MAX_DYNAMIC_GOOGLE_FONTS_PER_DESIGN) {
    throw new Error(
      `A Remotion design can use at most ${MAX_DYNAMIC_GOOGLE_FONTS_PER_DESIGN} on-demand Google Fonts`,
    );
  }

  const requestKey = `${baseManifestUrl}\n${dynamicFamilies.join('\n')}`;
  let pending = pendingManifests.get(requestKey);
  if (!pending) {
    pending = (async () => {
      const region = readEnv('REMOTION_LAMBDA_REGION') || readEnv('AWS_REGION') || 'us-east-1';
      const bucketName = readEnv('REMOTION_LAMBDA_BUCKET_NAME') || inferBucketName(baseManifestUrl);
      const result = await provisionRemotionFontFamilies({
        region,
        bucketName,
        // Derived manifests and content-addressed assets live beside the base
        // manifest, regardless of which deployed Remotion site initiated it.
        serveUrl: new URL(baseManifestUrl).origin,
        baseManifestUrl,
        families: dynamicFamilies,
        concurrency: Number(readEnv('REMOTION_FONT_PROVISION_CONCURRENCY') || 12),
      });
      return result.manifestUrl;
    })();
    pendingManifests.set(requestKey, pending);
  }
  try {
    return await pending;
  } catch (error) {
    pendingManifests.delete(requestKey);
    throw error;
  }
}
