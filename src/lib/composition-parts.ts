import { Buffer } from 'node:buffer';

export const COMPOSITION_PART_MAX_CHARS = 5_000;
export const COMPOSITION_PART_MAX_TOTAL_CHARS = 18_000;
export const COMPOSITION_PART_MAX_FILES = 16;
export const COMPOSITION_PART_FILENAME_PATTERN = /^\d{2}-[a-z0-9-]+\.js$/;

export interface CompositionPartSource {
  path: string;
  content: string;
}

export function compositionPartsPrefix(projectId: string): string {
  return `${projectId}/drafts/composition-parts/`;
}

export function decodeCompositionPartContent(content: string): string {
  const match = content.match(/^data:[^,]*;base64,([\s\S]+)$/);
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : content;
}

export function assembleCompositionParts(input: {
  projectId: string;
  parts: CompositionPartSource[];
}): { code: string; paths: string[]; totalChars: number } {
  if (input.parts.length < 2) throw new Error('At least two composition parts are required.');
  if (input.parts.length > COMPOSITION_PART_MAX_FILES) {
    throw new Error(`Composition supports at most ${COMPOSITION_PART_MAX_FILES} parts.`);
  }

  const prefix = compositionPartsPrefix(input.projectId);
  const seen = new Set<string>();
  const ordered = [...input.parts]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(part => ({ ...part, content: decodeCompositionPartContent(part.content) }));
  let totalChars = 0;

  for (const part of ordered) {
    if (!part.path.startsWith(prefix)) {
      throw new Error(`Composition part must be stored under ${prefix}: ${part.path}`);
    }
    const filename = part.path.slice(prefix.length);
    if (!COMPOSITION_PART_FILENAME_PATTERN.test(filename)) {
      throw new Error(`Composition part filename must be numbered, for example 00-foundation.js: ${filename}`);
    }
    if (seen.has(part.path)) throw new Error(`Duplicate composition part: ${part.path}`);
    seen.add(part.path);
    const content = part.content.trim();
    if (!content) throw new Error(`Composition part is empty: ${part.path}`);
    if (content.length > COMPOSITION_PART_MAX_CHARS) {
      throw new Error(`Composition part exceeds ${COMPOSITION_PART_MAX_CHARS} characters: ${part.path}`);
    }
    totalChars += content.length;
  }

  if (totalChars > COMPOSITION_PART_MAX_TOTAL_CHARS) {
    throw new Error(`Assembled composition exceeds ${COMPOSITION_PART_MAX_TOTAL_CHARS} characters.`);
  }

  return {
    code: ordered.map(part => part.content.trim()).join('\n\n'),
    paths: ordered.map(part => part.path),
    totalChars,
  };
}
