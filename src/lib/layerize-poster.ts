import sharp from 'sharp';
import type { LayerizeManifest } from './layerize-design';

/** Same initial raster geometry/order as buildLayerizeDesign, without a browser or fonts. */
export async function renderLayerizeRasterPoster(manifest: LayerizeManifest, sources: Map<number, Buffer>): Promise<Buffer> {
  const order = manifest.stackOrder || [...manifest.layers].sort((a, b) => a.z - b.z).map(layer => layer.z);
  const inputs = await Promise.all(order.map(async z => {
    const layer = manifest.layers.find(item => item.z === z), bytes = sources.get(z);
    if (!layer || !bytes) throw new Error('Layer poster source is missing');
    const [left, top, right, bottom] = layer.bounds;
    return { input: await sharp(bytes).resize(right - left, bottom - top, { fit: 'fill' }).ensureAlpha().png().toBuffer(), left, top };
  }));
  return sharp({ create: { width: manifest.width, height: manifest.height, channels: 4, background: '#00000000' } })
    .composite(inputs).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
}
