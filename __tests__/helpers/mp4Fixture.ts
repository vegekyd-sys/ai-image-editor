/** Minimal ISO BMFF movie header for metadata tests, no real media generation. */
export function mp4Fixture(duration = 5.184, v1 = false): Uint8Array {
  const mvhdSize = v1 ? 40 : 28;
  const bytes = new Uint8Array(8 + mvhdSize);
  const view = new DataView(bytes.buffer);
  const name = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(0, bytes.length); name(4, 'moov');
  view.setUint32(8, mvhdSize); name(12, 'mvhd');
  bytes[16] = v1 ? 1 : 0;
  view.setUint32(8 + (v1 ? 28 : 20), 1000);
  if (v1) view.setBigUint64(40, BigInt(Math.round(duration * 1000)));
  else view.setUint32(32, Math.round(duration * 1000));
  return bytes;
}
