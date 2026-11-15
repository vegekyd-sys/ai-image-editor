import type { DesignPayload, EditableField } from '@/types';
import { ASYNC_LAYERIZE_FONTS_MARKER, type LayerizeFontsReference } from './layerize-fonts';
import type { LayerizeTextFit } from './layerize-text-fit';

const LAYERIZE_CODE_START = "import React from 'react';\nimport {AbsoluteFill, Img} from 'remotion';\nexport default function Composition(props) { return <AbsoluteFill style={{backgroundColor:'transparent'}}>";
const LAYERIZE_CODE_END = '</AbsoluteFill>; }';

/** Pure generated JSX shared by Player, Proxy, preview_frame and Export. */
const LAYERIZE_TEXT_RENDERER = `/* makaron-layerize-text-v2 */
function LayerizeText({value, original, source, width, height, fit, pending}) {
  if (value === original || pending) return <Img src={source} style={{width:'100%',height:'100%'}} />;
  const matrix = fit.matrix, em = fit.fontSize, spacing = fit.letterSpacing || 0;
  const advance = c => (fit.advances?.[c] ?? (/[^\\u0000-\\u024f]/u.test(c) ? em : em * .58)) + spacing;
  const originalAdvance = Math.max(0, ...String(original).split('\\n').map(row => Array.from(row).reduce((n, c) => n + advance(c), 0)));
  const maxAdvance = Math.max(originalAdvance, width / Math.max(.000001, Math.hypot(matrix[0], matrix[1])));
  const lines = [];
  for (const paragraph of String(value ?? '').split('\\n')) {
    let row = '', used = 0;
    for (const char of Array.from(paragraph)) {
      const next = advance(char);
      if (row && used + next > maxAdvance) { lines.push(row); row = ''; used = 0; }
      row += char; used += next;
    }
    lines.push(row);
  }
  // Quote every named CSS family: an unquoted trailing numeric token (Symbols 2)
  // invalidates the entire declaration, silently enabling platform font fallback.
  const family = [fit.family, 'Noto Sans SC', 'Noto Color Emoji', 'Noto Sans Symbols 2'].map(f => JSON.stringify(f)).join(',') + ',sans-serif';
  return <svg width="100%" height="100%" viewBox={'0 0 ' + width + ' ' + height} style={{overflow:'visible'}}><text fontSize={em} transform={'matrix(' + matrix.join(' ') + ')'} style={{fontFamily:family,fontWeight:fit.weight,fill:fit.color,letterSpacing:spacing,whiteSpace:'pre'}}>{lines.map((line, i) => <tspan key={i} x={0} y={i * (fit.lineHeight || em * 1.4)}>{line}</tspan>)}</text></svg>;
}
`;

/** Recognize the image-only generated composition, including existing saved drafts.
 * Editable labels/history are UI metadata and must not trigger font downloads.
 * Any native text or authored composition continues through the pinned font path.
 */
export function isRasterLayerizeDesign(design: DesignPayload): boolean {
  if (design.animation || !design.editables?.length || !design.editables.every(field => field.type === 'image')) return false;
  if (!design.code.startsWith(LAYERIZE_CODE_START) || !design.code.endsWith(LAYERIZE_CODE_END)) return false;
  const body = design.code.slice(LAYERIZE_CODE_START.length, -LAYERIZE_CODE_END.length);
  const images = /<Img data-editable="layer_\d+" src=\{props\.layer_\d+\} style=\{\{[^{}<>]*\}\} \/>/g;
  return (body.match(images)?.length ?? 0) > 0 && !body.replace(images, '').trim();
}

export interface LayerizeLayer {
  z: number;
  url: string;
  width: number;
  height: number;
  bounds: [number, number, number, number];
  name: string;
  text?: { preserveRaster?: boolean; remainderUrl?: string; lines: Array<{ text: string; bounds: [number, number, number, number]; font: string; color: string; bold: boolean; italic: boolean; appearance?: { rasterUrl: string; width: number; height: number; bounds: [number, number, number, number]; fit?: LayerizeTextFit } }> };
}
export interface LayerizeManifest {
  version: 1;
  taskId: string;
  width: number;
  height: number;
  sourceSha256: string;
  supplierCostUsd: number;
  layers: LayerizeLayer[];
  stackOrder?: number[];
  reconstruction?: { changed: boolean; scoreBefore?: number; scoreAfter?: number; reason?: string };
}

/** Use the normal DesignPayload/Img/editable ABI, with one independent source prop per layer. */
export function buildLayerizeDesign(manifest: LayerizeManifest, editableText = false, fontMatching?: Omit<LayerizeFontsReference, 'originals' | 'status'>): DesignPayload {
  const props: Record<string, unknown> = {};
  const editables: EditableField[] = [];
  const elements: string[] = [];
  const sorted = [...manifest.layers].sort((a, b) => a.z - b.z);
  const attachments: Record<string, string> = {};
  const order = manifest.stackOrder;
  if (order && (order[0] !== 0 || order.length !== sorted.length || new Set(order).size !== sorted.length || order.some(z => !sorted.some(layer => layer.z === z)))) throw new Error('Invalid layer stack inventory');
  for (const layer of order ? order.map(z => sorted.find(layer => layer.z === z)!) : sorted) {
    const tag = /\s*\[on:\s*([^\]]+)\]\s*$/i.exec(layer.name);
    const label = tag ? layer.name.slice(0, tag.index).trim() : layer.name;
    const parents = tag ? sorted.filter(p => p.z !== 0 && p.z !== layer.z && p.name.trim() === tag[1].trim()) : [];
    const parent = parents.length === 1 ? parents[0] : undefined;
    const parentId = parent && (editableText && parent.text?.lines.length && !parent.text.preserveRaster
      ? (parent.text.remainderUrl ? `layer_${parent.z}_artwork` : undefined) : `layer_${parent.z}`);
    if (editableText && layer.text?.lines.length && !layer.text.preserveRaster) {
      if (layer.text.remainderUrl) {
        const id = `layer_${layer.z}_artwork`; props[id] = layer.text.remainderUrl;
        if (parentId) attachments[id] = parentId;
        editables.push({ id, propKey: id, type: 'image', label });
        const [left, top, right, bottom] = layer.bounds;
        elements.push(`<Img data-editable=${JSON.stringify(id)} src={props.${id}} style={${JSON.stringify({ position: 'absolute', left, top, width: right-left, height: bottom-top, objectFit: 'fill' })}} />`);
      }
      for (const [index, line] of layer.text.lines.entries()) {
        const id = `layer_${layer.z}_text_${index}`, key = id;
        props[key] = line.text;
        if (parentId) attachments[id] = parentId;
        editables.push({ id, propKey: key, type: 'text', label: line.text || `${label} ${index + 1}` });
        if (line.appearance) {
          const a = line.appearance, fit = a.fit;
          props[`${id}_source`] = a.rasterUrl;
          const [left, top, right, bottom] = a.bounds;
          const style = { position: 'absolute', left, top, width: right-left, height: bottom-top };
          // A raster crop may contain transparent padding; neither its height nor
          // Latin's average character width is a safe CJK font-size measurement.
          const units = Array.from(line.text).reduce((n, c) => n + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c) ? 1 : .58), 0);
          const fontSize = Math.min(a.height, a.width / Math.max(1, units));
          const fallback = fit || { family: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line.text) ? 'Noto Sans SC' : line.font,
            weight: line.bold ? 700 : 400, color: line.color, matrix: [1, 0, 0, 1, 3, fontSize * .88 + 3], fontSize };
          elements.push(`<div data-editable=${JSON.stringify(id)} style={${JSON.stringify(style)}}><LayerizeText value={props.${key}} original={${JSON.stringify(line.text)}} source={props.${id}_source} width={${a.width}} height={${a.height}} fit={props._layerizeTextFontFits?.${id} || ${JSON.stringify(fallback)}} pending={props._layerizeTextFonts?.status === 'pending'} /></div>`);
          continue;
        }
        const [left, top, right, bottom] = line.bounds;
        const style = { position: 'absolute', left, top, width: right - left, height: bottom - top,
          fontFamily: line.font, fontSize: (bottom - top) * 1.12, lineHeight: 1, whiteSpace: 'pre',
          color: line.color, fontWeight: line.bold ? 700 : 400, fontStyle: line.italic ? 'italic' : 'normal' };
        elements.push(`<div data-editable=${JSON.stringify(id)} style={${JSON.stringify(style).replace(/"(fontFamily|fontWeight|fontStyle)":/g, '$1:')}}>{props.${key}}</div>`);
      }
      continue;
    }
    const id = `layer_${layer.z}`, key = id;
    props[key] = layer.url;
    if (parentId) attachments[id] = parentId;
    editables.push({ id, propKey: key, type: 'image', label });
    const [left, top, right, bottom] = layer.bounds;
    const style = { position: 'absolute', left, top, width: right - left, height: bottom - top, objectFit: 'fill' };
    elements.push(`<Img data-editable=${JSON.stringify(id)} src={props.${key}} style={${JSON.stringify(style)}} />`);
  }
  props._layerState = { order: editables.map(field => field.id), deleted: [] };
  if (Object.keys(attachments).length) props._layerizeAttachments = attachments;
  props._canvasSizing = 'fixed';
  if (fontMatching) props._layerizeTextFonts = { ...fontMatching, status: 'pending', originals: Object.fromEntries(editables.filter(field => field.type === 'text').map(field => [field.id, props[field.propKey]])) };
  return {
    width: manifest.width, height: manifest.height, props, editables,
    code: `${(fontMatching ? ASYNC_LAYERIZE_FONTS_MARKER + "\n" : "") + (editableText ? "/* fontWeight:400 fontWeight:500 fontWeight:600 fontWeight:700 fontWeight:800 fontWeight:900 */\n" : "")}${editableText ? LAYERIZE_CODE_START.replace('export default function', LAYERIZE_TEXT_RENDERER + '\nexport default function') : LAYERIZE_CODE_START}${elements.join('\n')}${LAYERIZE_CODE_END}`,
  };
}

export function layerizeSupplierCost(layers: Array<{ width: number; height: number }>): number {
  if (!layers.length || layers.some(layer => !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width <= 0 || layer.height <= 0)) throw new Error('Invalid layer dimensions');
  return Number((0.0064 + layers.reduce((sum, layer) => sum + (layer.width * layer.height <= 2_610_000 ? 0.016 : 0.028), 0)).toFixed(4));
}
