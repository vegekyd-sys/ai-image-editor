import sharp from 'sharp';

async function readImage(input: string): Promise<Buffer> {
  if (input.startsWith('http')) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Source image download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (input.startsWith('data:image/')) {
    const separator = input.indexOf(';base64,');
    if (separator >= 0) return Buffer.from(input.slice(separator + ';base64,'.length), 'base64');
  }
  return Buffer.from(input, 'base64');
}

/**
 * Restore the source canvas dimensions after GPT Image 2 chooses one of its
 * fixed output sizes. The generated cutout is scaled uniformly and padded
 * with transparency; it is never stretched, cropped, or composited with a
 * different model's output.
 */
export async function fitTransparentResultToSourceCanvas(
  sourceInput: string,
  generatedTransparentImage: string,
): Promise<string> {
  const [sourceBytes, generatedBytes] = await Promise.all([
    readImage(sourceInput),
    readImage(generatedTransparentImage),
  ]);
  const [sourceMetadata, generatedMetadata] = await Promise.all([
    sharp(sourceBytes).metadata(),
    sharp(generatedBytes).metadata(),
  ]);
  const sourceWidth = sourceMetadata.autoOrient?.width ?? sourceMetadata.width;
  const sourceHeight = sourceMetadata.autoOrient?.height ?? sourceMetadata.height;
  if (!sourceWidth || !sourceHeight) throw new Error('Source image dimensions are unavailable');
  if (generatedMetadata.width === sourceWidth && generatedMetadata.height === sourceHeight) {
    return `data:image/png;base64,${generatedBytes.toString('base64')}`;
  }
  const png = await sharp(generatedBytes)
    .resize(sourceWidth, sourceHeight, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

function parseAspectRatio(aspectRatio: string): number | null {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

/**
 * GPT Image 2 exposes a small set of fixed generation sizes, so a requested
 * ratio such as 16:9 is generated at the closest landscape preset. Convert
 * that result to an exact transparent canvas without cropping or stretching
 * any generated pixels.
 */
export async function fitTransparentResultToAspectRatio(
  generatedTransparentImage: string,
  aspectRatio: string,
): Promise<string> {
  const targetRatio = parseAspectRatio(aspectRatio);
  if (!targetRatio) throw new Error(`Invalid aspect ratio: ${aspectRatio}`);

  const generatedBytes = await readImage(generatedTransparentImage);
  const metadata = await sharp(generatedBytes).metadata();
  const generatedWidth = metadata.autoOrient?.width ?? metadata.width;
  const generatedHeight = metadata.autoOrient?.height ?? metadata.height;
  if (!generatedWidth || !generatedHeight) {
    throw new Error('Generated image dimensions are unavailable');
  }

  const longSide = Math.max(generatedWidth, generatedHeight);
  const targetWidth = targetRatio >= 1
    ? longSide
    : Math.max(1, Math.round(longSide * targetRatio));
  const targetHeight = targetRatio >= 1
    ? Math.max(1, Math.round(longSide / targetRatio))
    : longSide;

  if (generatedWidth === targetWidth && generatedHeight === targetHeight) {
    return `data:image/png;base64,${generatedBytes.toString('base64')}`;
  }

  const png = await sharp(generatedBytes)
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
