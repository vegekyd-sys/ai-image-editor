import sharp from 'sharp';

export async function prepareLayerizeSource(source: Buffer) {
  const image = sharp(source, { limitInputPixels: 36_000_000 });
  const meta = await image.metadata();
  const { width = 0, height = 0 } = meta.autoOrient;
  if (!['png', 'jpeg'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1 || width <= 14 || height <= 14 || width / height < 1 / 16 || width / height > 16) {
    throw new Error('Use one still PNG/JPEG original, dimensions >14px and at most 30MB/36MP. No task was submitted.');
  }
  const normalized = !!meta.orientation && meta.orientation !== 1;
  const png = meta.format === 'png';
  const bytes = normalized ? await (png ? image.rotate().png() : image.rotate().jpeg({ quality: 98, chromaSubsampling: '4:4:4' })).toBuffer() : source;
  return { bytes, width, height, normalized, extension: png ? 'png' : 'jpg', contentType: png ? 'image/png' : 'image/jpeg' };
}
