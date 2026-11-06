import { getAvailableFonts } from '@remotion/google-fonts';
import {
  collectRemotionFontFamilyCandidates,
  prepareRemotionFontCode,
  REMOTION_FONT_CATALOG,
  REMOTION_FONT_CATALOG_VERSION,
} from '@/remotion/font-catalog';

let googleFontNames: Map<string, string> | null = null;

function googleFontName(candidate: string): string | undefined {
  googleFontNames ??= new Map(
    getAvailableFonts().map((font) => [font.fontFamily.toLowerCase(), font.fontFamily]),
  );
  return googleFontNames.get(candidate.trim().toLowerCase());
}

/**
 * Static font check for Agent tool results. It runs the same preparation as
 * Player, Sandbox preview and Lambda export against the pinned catalog plus
 * any Google Fonts family the composition names, without fetching a manifest.
 * The Agent sees the cause next to its draft instead of inferring it from a
 * Linux frame where CJK text is missing.
 */
export function remotionFontWarnings(design: {
  code?: unknown;
  props?: unknown;
  fontSubstitutions?: unknown;
}): string[] {
  if (typeof design.code !== 'string' || !design.code) return [];
  const props = design.props && typeof design.props === 'object'
    ? design.props as Record<string, unknown>
    : undefined;
  const substitutions = design.fontSubstitutions && typeof design.fontSubstitutions === 'object'
    ? design.fontSubstitutions as Record<string, string>
    : undefined;
  try {
    const families = new Set(REMOTION_FONT_CATALOG.map(({ family }) => family));
    for (const candidate of collectRemotionFontFamilyCandidates({ code: design.code, props, substitutions })) {
      const family = googleFontName(candidate);
      if (family) families.add(family);
    }
    return prepareRemotionFontCode({
      code: design.code,
      props,
      substitutions,
      manifest: {
        version: REMOTION_FONT_CATALOG_VERSION,
        faces: [...families].map((family) => ({ family })),
      },
    }).warnings;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export function remotionFontWarningText(design: Parameters<typeof remotionFontWarnings>[0]): string {
  const warnings = remotionFontWarnings(design);
  if (warnings.length === 0) return '';
  return `\n\nFont check (fix before publishing):\n${warnings.map((warning) => `- ${warning}`).join('\n')}`;
}
