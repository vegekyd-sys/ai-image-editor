import sharp from 'sharp';
import type { LayerizeLayer } from './layerize-design';
import { fitLayerizeText, layerizeMatchingFaces } from './layerize-text-fit';

export async function prepareLayerizeTextLayers(layers: LayerizeLayer[], bytes: Map<number, Buffer>, persist: (name: string, bytes: Buffer) => Promise<string>): Promise<void> {
  const textLayers = layers.filter(l => l.text?.lines.some(line => line.text.trim()));
  if (!textLayers.length) return;
  const faces = await layerizeMatchingFaces(textLayers.flatMap(l => l.text!.lines.map(line => line.font))).catch(() => []);
  await Promise.all(textLayers.map(async layer => {
    const original = bytes.get(layer.z); if (!original) throw new Error('Text layer pixels are missing');
    const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const remainder = Buffer.from(data), lines = layer.text!.lines;
    const sx = (layer.bounds[2] - layer.bounds[0]) / info.width, sy = (layer.bounds[3] - layer.bounds[1]) / info.height;
    for (const [index, line] of lines.entries()) {
      const lineBox = lines.length === 1 ? { left: 0, top: 0, width: info.width, height: info.height } : (() => {
        const padding = (line.bounds[3] - line.bounds[1]) * .12;
        const left = Math.min(info.width - 1, Math.max(0, Math.floor((line.bounds[0] - padding - layer.bounds[0]) / sx)));
        const top = Math.min(info.height - 1, Math.max(0, Math.floor((line.bounds[1] - padding - layer.bounds[1]) / sy)));
        return { left, top, width: Math.max(1, Math.min(info.width - left, Math.ceil((line.bounds[2] + padding - layer.bounds[0]) / sx) - left)), height: Math.max(1, Math.min(info.height - top, Math.ceil((line.bounds[3] + padding - layer.bounds[1]) / sy) - top)) };
      })();
      let left = info.width, top = info.height, right = 0, bottom = 0;
      for (let y = lineBox.top; y < lineBox.top + lineBox.height; y++) for (let x = lineBox.left; x < lineBox.left + lineBox.width; x++) {
        if (remainder[(y * info.width + x) * 4 + 3] <= 8) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      if (right <= left || bottom <= top) continue;
      left = Math.max(lineBox.left, left - 3); top = Math.max(lineBox.top, top - 3);
      right = Math.min(lineBox.left + lineBox.width, right + 3); bottom = Math.min(lineBox.top + lineBox.height, bottom + 3);
      const region = { left, top, width: right - left, height: bottom - top };
      const cropped = await sharp(remainder, { raw: { width: info.width, height: info.height, channels: 4 } }).extract(region).png().toBuffer();
      const fit = await fitLayerizeText(cropped, line.text, line.font, line.color, faces).catch(() => null);
      const rasterUrl = await persist(`text-${layer.z}-${index}.png`, cropped);
      line.appearance = { rasterUrl, width: region.width, height: region.height,
        bounds: [layer.bounds[0] + left * sx, layer.bounds[1] + top * sy, layer.bounds[0] + right * sx, layer.bounds[1] + bottom * sy],
        ...(fit ? { fit } : {}) };
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) remainder[(y * info.width + x) * 4 + 3] = 0;
    }
    if (lines.every(line => line.appearance)) {
      if (remainder.some((value, i) => i % 4 === 3 && value > 8)) {
        layer.text!.remainderUrl = await persist(`text-${layer.z}-remainder.png`, await sharp(remainder, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
      }
    } else {
      // Incomplete OCR must not erase unrecognized lettering or artwork.
      layer.text!.preserveRaster = true;
    }
  }));
}
