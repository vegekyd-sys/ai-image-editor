import sharp from 'sharp';

export interface ContactSheetFrame {
  image: Buffer;
  label: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function createContactSheet(
  frames: ContactSheetFrame[],
  sourceWidth: number,
  sourceHeight: number,
): Promise<Buffer> {
  if (frames.length < 2) throw new Error('Contact sheet requires at least two frames');

  const scale = Math.min(1, 480 / sourceWidth, 360 / sourceHeight);
  const tileWidth = Math.max(1, Math.round(sourceWidth * scale));
  const tileHeight = Math.max(1, Math.round(sourceHeight * scale));
  const labelHeight = 34;
  const sheetWidth = tileWidth * frames.length;
  const sheetHeight = tileHeight + labelHeight;

  const tiles = await Promise.all(frames.map(async (frame, index) => ({
    input: await sharp(frame.image)
      .resize(tileWidth, tileHeight, { fit: 'cover' })
      .jpeg({ quality: 86 })
      .toBuffer(),
    left: index * tileWidth,
    top: 0,
  })));

  const labels = frames.map((frame, index) => ({
    input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0b0b0d"/>
      <text x="12" y="22" fill="#f3f3f5" font-family="Arial, sans-serif" font-size="14">${escapeXml(frame.label)}</text>
    </svg>`),
    left: index * tileWidth,
    top: tileHeight,
  }));

  return sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: '#0b0b0d',
    },
  })
    .composite([...tiles, ...labels])
    .jpeg({ quality: 88 })
    .toBuffer();
}
