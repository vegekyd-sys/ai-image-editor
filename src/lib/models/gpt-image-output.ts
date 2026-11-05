import sharp from 'sharp';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { ImageBackground, ImageOutputFormat } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_ELEMENTS = new Set('svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath mask pattern filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feDropShadow'.split(' '));
/** Reject active/external SVG content, retain genuine vector paths. Render only as img, never inline HTML. */
export function validateGeneratedSvg(buffer: Buffer): string {
  const source = buffer.toString('utf8');
  if (buffer.length > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error('Unsupported SVG document');
  const document = new DOMParser({ onError: (level, message) => { throw new Error(`Invalid SVG XML (${level}): ${message.slice(0, 80)}`); } }).parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) throw new Error('Expected SVG root');
  const nodes = root.getElementsByTagName('*');
  if (nodes.length > 50000) throw new Error('SVG element limit exceeded');
  for (const node of [root, ...Array.from(nodes)]) {
    if (node.namespaceURI !== SVG_NS || !SVG_ELEMENTS.has(node.localName ?? "")) throw new Error(`Unsupported SVG element: ${node.localName}`);
    for (const attr of Array.from(node.attributes)) {
      const name = (attr.localName ?? attr.name).toLowerCase();
      const value = attr.value;
      if (/^on/i.test(name) || /javascript:|vbscript:|data:|@import|expression\s*\(|[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(value)) throw new Error('Active SVG attribute rejected');
      if (attr.namespaceURI && !['http://www.w3.org/2000/xmlns/', 'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/1999/xlink'].includes(attr.namespaceURI)) throw new Error('Unsupported SVG attribute namespace');
      if (name === 'href' && !/^#[A-Za-z_][\w:.-]*$/.test(value)) throw new Error('External SVG reference rejected');
      if (/url\s*\(/i.test(value) && !/^.*url\(\s*['"]?#[\w:.-]+['"]?\s*\).*$/.test(value)) throw new Error('External SVG URL rejected');
      if (name === 'base') throw new Error('SVG base URL rejected');
      // Every url() must be local, including additional CSS declarations.
      for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) if (!/^\s*['"]?#[\w:.-]+['"]?\s*$/.test(match[1])) throw new Error('External SVG URL rejected');
    }
  }
  return new XMLSerializer().serializeToString(document);
}

/** Keep the original GIF frames / SVG vectors; decode for validation without replacing the deliverable. */
export async function preserveGptImageOutput(buffer: Buffer, format: ImageOutputFormat, background?: ImageBackground): Promise<string> {
  if (buffer.length > 50 * 1024 * 1024) throw new Error('Image output exceeds 50 MB');
  const safe = format === 'svg' ? Buffer.from(validateGeneratedSvg(buffer)) : buffer;
  const input = sharp(safe, { animated: format === 'gif', failOn: 'error', limitInputPixels: 8294400 });
  const metadata = await input.metadata();
  const expected = format === 'jpeg' ? 'jpeg' : format;
  if (metadata.format !== expected) throw new Error(`Expected ${format}, received ${metadata.format}`);
  const frames = metadata.pages ?? 1;
  if (format === 'gif' && frames < 2) throw new Error('Provider returned a static GIF');
  if (format !== 'gif' && frames > 1) throw new Error('Unexpected animated output');
  if (!metadata.width || !metadata.height || metadata.width > 3840 || (metadata.pageHeight ?? metadata.height) > 3840) throw new Error('Invalid output dimensions');
  await input.clone().raw().toBuffer();
  if (background === 'transparent' && format !== 'svg') {
    if (!metadata.hasAlpha) throw new Error('Requested transparent image has no alpha');
    const stats = await input.clone().stats();
    if (!stats.channels.at(-1) || stats.channels.at(-1)!.min === 255) throw new Error('Requested transparent image is opaque');
  }
  const mime = format === 'svg' ? 'image/svg+xml' : `image/${format}`;
  return `data:${mime};base64,${safe.toString('base64')}`;
}
