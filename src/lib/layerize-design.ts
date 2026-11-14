import type { DesignPayload, EditableField } from '@/types';
import type { LayerizeTextFit } from './layerize-text-fit';

const LAYERIZE_CODE_START = "import React from 'react';\nimport {AbsoluteFill, Img} from 'remotion';\nexport default function Composition(props) { return <AbsoluteFill style={{backgroundColor:'transparent'}}>";
const LAYERIZE_CODE_END = '</AbsoluteFill>; }';

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
export function buildLayerizeDesign(manifest: LayerizeManifest, editableText = false): DesignPayload {
  const props: Record<string, unknown> = {};
  const editables: EditableField[] = [];
  const elements: string[] = [];
  const sorted = [...manifest.layers].sort((a, b) => a.z - b.z);
  const order = manifest.stackOrder;
  if (order && (order[0] !== 0 || order.length !== sorted.length || new Set(order).size !== sorted.length || order.some(z => !sorted.some(layer => layer.z === z)))) throw new Error('Invalid layer stack inventory');
  for (const layer of order ? order.map(z => sorted.find(layer => layer.z === z)!) : sorted) {
    if (editableText && layer.text?.lines.length && !layer.text.preserveRaster) {
      if (layer.text.remainderUrl) {
        const id = `layer_${layer.z}_artwork`; props[id] = layer.text.remainderUrl;
        editables.push({ id, propKey: id, type: 'image', label: layer.name });
        const [left, top, right, bottom] = layer.bounds;
        elements.push(`<Img data-editable=${JSON.stringify(id)} src={props.${id}} style={${JSON.stringify({ position: 'absolute', left, top, width: right-left, height: bottom-top, objectFit: 'fill' })}} />`);
      }
      for (const [index, line] of layer.text.lines.entries()) {
        const id = `layer_${layer.z}_text_${index}`, key = id;
        props[key] = line.text;
        editables.push({ id, propKey: key, type: 'text', label: line.text || `${layer.name} ${index + 1}` });
        if (line.appearance) {
          const a = line.appearance, fit = a.fit;
          props[`${id}_source`] = a.rasterUrl;
          const [left, top, right, bottom] = a.bounds;
          const style = { position: 'absolute', left, top, width: right-left, height: bottom-top };
          const fontStyle = { fontFamily: fit?.family || line.font, fontWeight: fit?.weight || (line.bold ? 700 : 400), fill: fit?.color || line.color };
          const matrix = fit?.matrix || [a.width / Math.max(1, line.text.length * .58 * a.height), 0, 0, 1, 0, a.height * .82];
          const fontSize = fit?.fontSize || a.height;
          elements.push(`<div data-editable=${JSON.stringify(id)} style={${JSON.stringify(style)}}>{props.${key} === ${JSON.stringify(line.text)} ? <Img src={props.${id}_source} style={{width:'100%',height:'100%'}} /> : <svg width="100%" height="100%" viewBox="0 0 ${a.width} ${a.height}" style={{overflow:'visible'}}><text fontSize={${fontSize}} transform="matrix(${matrix.join(' ')})" style={${JSON.stringify(fontStyle).replace('"fontFamily":', 'fontFamily:')}}>{props.${key}}</text></svg>}</div>`);
          continue;
        }
        const [left, top, right, bottom] = line.bounds;
        const style = { position: 'absolute', left, top, width: right - left, height: bottom - top,
          fontFamily: line.font, fontSize: (bottom - top) * 1.12, lineHeight: 1, whiteSpace: 'pre',
          color: line.color, fontWeight: line.bold ? 700 : 400, fontStyle: line.italic ? 'italic' : 'normal' };
        elements.push(`<div data-editable=${JSON.stringify(id)} style={${JSON.stringify(style).replace('"fontFamily":', 'fontFamily:')}}>{props.${key}}</div>`);
      }
      continue;
    }
    const id = `layer_${layer.z}`, key = id;
    props[key] = layer.url;
    editables.push({ id, propKey: key, type: 'image', label: layer.name });
    const [left, top, right, bottom] = layer.bounds;
    const style = { position: 'absolute', left, top, width: right - left, height: bottom - top, objectFit: 'fill' };
    elements.push(`<Img data-editable=${JSON.stringify(id)} src={props.${key}} style={${JSON.stringify(style)}} />`);
  }
  props._layerState = { order: editables.map(field => field.id), deleted: [] };
  props._canvasSizing = 'fixed';
  return {
    width: manifest.width, height: manifest.height, props, editables,
    code: `${LAYERIZE_CODE_START}${elements.join('\n')}${LAYERIZE_CODE_END}`,
  };
}

export function layerizeSupplierCost(layers: Array<{ width: number; height: number }>): number {
  if (!layers.length || layers.some(layer => !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width <= 0 || layer.height <= 0)) throw new Error('Invalid layer dimensions');
  return Number((0.0064 + layers.reduce((sum, layer) => sum + (layer.width * layer.height <= 2_610_000 ? 0.016 : 0.028), 0)).toFixed(4));
}
