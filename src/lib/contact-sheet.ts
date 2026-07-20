import sharp from 'sharp';

export interface ContactSheetFrame {
  image: Buffer;
  label: string;
}

// Contact sheets are rendered by Sharp/libvips in a serverless runtime where
// system fonts are not guaranteed to exist. Keep labels font-independent so a
// missing Arial/fontconfig installation cannot turn frame metadata into tofu.
const LABEL_GLYPHS: Record<string, readonly string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '01010'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  a: ['00000', '01110', '00001', '01111', '10001', '10011', '01101'],
  e: ['00000', '01110', '10001', '11111', '10000', '10001', '01110'],
  f: ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
  m: ['00000', '11010', '10101', '10101', '10101', '10101', '10101'],
  r: ['00000', '10110', '11001', '10000', '10000', '10000', '10000'],
  s: ['00000', '01111', '10000', '01110', '00001', '10001', '01110'],
};

export function renderContactSheetLabelSvg(
  label: string,
  width: number,
  height: number,
): Buffer {
  const normalized = label.toLowerCase();
  const glyphWidth = 5;
  const glyphGap = 1;
  const horizontalPadding = 12;
  const totalUnits = Math.max(1, normalized.length * (glyphWidth + glyphGap) - glyphGap);
  const pixelSize = Math.max(0.75, Math.min(2, (width - horizontalPadding * 2) / totalUnits));
  const renderedWidth = totalUnits * pixelSize;
  const startX = Math.max(horizontalPadding, (width - renderedWidth) / 2);
  const startY = (height - 7 * pixelSize) / 2;

  const pixels: string[] = [];
  for (const [glyphIndex, character] of [...normalized].entries()) {
    const glyph = LABEL_GLYPHS[character] ?? LABEL_GLYPHS['?'];
    for (const [rowIndex, row] of glyph.entries()) {
      for (const [columnIndex, value] of [...row].entries()) {
        if (value !== '1') continue;
        const x = startX + (glyphIndex * (glyphWidth + glyphGap) + columnIndex) * pixelSize;
        const y = startY + rowIndex * pixelSize;
        pixels.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${pixelSize.toFixed(2)}" height="${pixelSize.toFixed(2)}" fill="#f3f3f5"/>`);
      }
    }
  }

  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0b0b0d"/>
    ${pixels.join('')}
  </svg>`);
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
    input: renderContactSheetLabelSvg(frame.label, tileWidth, labelHeight),
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
