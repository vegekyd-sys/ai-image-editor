import type { DesignPayload, EditableField } from '@/types';

export interface LayerizeLayer {
  z: number;
  url: string;
  width: number;
  height: number;
  bounds: [number, number, number, number];
  name: string;
  text?: { lines: Array<{ text: string; bounds: [number, number, number, number]; font: string; color: string; bold: boolean; italic: boolean }> };
}
export interface LayerizeManifest {
  version: 1;
  taskId: string;
  width: number;
  height: number;
  sourceSha256: string;
  supplierCostUsd: number;
  layers: LayerizeLayer[];
}

/** Use the normal DesignPayload/Img/editable ABI, with one independent source prop per layer. */
export function buildLayerizeDesign(manifest: LayerizeManifest, editableText = false): DesignPayload {
  const props: Record<string, unknown> = {};
  const editables: EditableField[] = [];
  const elements: string[] = [];
  for (const layer of [...manifest.layers].sort((a, b) => a.z - b.z)) {
    if (editableText && layer.text?.lines.length) {
      for (const [index, line] of layer.text.lines.entries()) {
        const id = `layer_${layer.z}_text_${index}`, key = id;
        props[key] = line.text;
        editables.push({ id, propKey: key, type: 'text', label: `${layer.name} ${index + 1}` });
        const [left, top, right, bottom] = line.bounds;
        const style = { position: 'absolute', left, top, width: right - left, height: bottom - top,
          fontFamily: line.font, fontSize: (bottom - top) * 1.12, lineHeight: 1, whiteSpace: 'pre',
          color: line.color, fontWeight: line.bold ? 700 : 400, fontStyle: line.italic ? 'italic' : 'normal' };
        elements.push(`<div data-editable=${JSON.stringify(id)} style={${JSON.stringify(style)}}>{props.${key}}</div>`);
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
  return {
    width: manifest.width, height: manifest.height, props, editables,
    code: `import React from 'react';\nimport {AbsoluteFill, Img} from 'remotion';\nexport default function Composition(props) { return <AbsoluteFill style={{backgroundColor:'transparent'}}>${elements.join('\n')}</AbsoluteFill>; }`,
  };
}

export function layerizeSupplierCost(layers: Array<{ width: number; height: number }>): number {
  if (!layers.length || layers.some(layer => !Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height) || layer.width <= 0 || layer.height <= 0)) throw new Error('Invalid layer dimensions');
  return Number((0.0064 + layers.reduce((sum, layer) => sum + (layer.width * layer.height <= 2_610_000 ? 0.016 : 0.028), 0)).toFixed(4));
}
