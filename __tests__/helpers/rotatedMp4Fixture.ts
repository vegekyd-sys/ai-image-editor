export function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children), header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8); header.write(type, 4);
  return Buffer.concat([header, body]);
}
export function videoTrack(width = 1920, height = 1080, rotation = 0, v1 = false, handlerType = 'vide'): Buffer {
  const tkhd = Buffer.alloc(v1 ? 96 : 84);
  tkhd[0] = v1 ? 1 : 0;
  const m = v1 ? 52 : 40;
  const angle = rotation * Math.PI / 180;
  tkhd.writeInt32BE(Math.round(Math.cos(angle) * 65536), m);
  tkhd.writeInt32BE(Math.round(Math.sin(angle) * 65536), m + 4);
  tkhd.writeInt32BE(Math.round(-Math.sin(angle) * 65536), m + 12);
  tkhd.writeInt32BE(Math.round(Math.cos(angle) * 65536), m + 16);
  tkhd.writeInt32BE(1 << 30, m + 32);
  tkhd.writeUInt32BE(width * 65536, m + 36); tkhd.writeUInt32BE(height * 65536, m + 40);
  const handler = Buffer.alloc(12); handler.write(handlerType, 8);
  return box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', handler)));
}
export function rotatedMp4(rotation = 90, v1 = false): Buffer {
  return box('moov', videoTrack(1920, 1080, rotation, v1));
}
