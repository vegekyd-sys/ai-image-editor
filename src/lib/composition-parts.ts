import { Buffer } from 'node:buffer';

export const COMPOSITION_PART_MAX_CHARS = 12_000;
export const COMPOSITION_PART_FILENAME_PATTERN = /^\d{2,}-[a-z0-9-]+\.js$/;

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

  const prefix = compositionPartsPrefix(input.projectId);
  const seen = new Set<string>();
  const decoded = input.parts.map(part => ({
    ...part,
    content: decodeCompositionPartContent(part.content),
  }));
  let totalChars = 0;

  for (const part of decoded) {
    if (!part.path.startsWith(prefix)) {
      throw new Error(`Composition part must be stored under ${prefix}: ${part.path}`);
    }
    const filename = part.path.slice(prefix.length);
    if (!COMPOSITION_PART_FILENAME_PATTERN.test(filename)) {
      throw new Error(`Composition part filename must have a numeric prefix of at least two digits, for example 00-foundation.js or 120-scene.js: ${filename}`);
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

  const ordered = [...decoded].sort((left, right) => {
    const leftFilename = left.path.slice(prefix.length);
    const rightFilename = right.path.slice(prefix.length);
    const leftOrder = Number.parseInt(leftFilename, 10);
    const rightOrder = Number.parseInt(rightFilename, 10);
    return leftOrder - rightOrder || leftFilename.localeCompare(rightFilename);
  });

  return {
    code: ordered.map(part => part.content.trim()).join('\n\n'),
    paths: ordered.map(part => part.path),
    totalChars,
  };
}
