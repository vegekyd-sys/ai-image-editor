declare module 'heic-convert' {
  export default function convert(input: {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer | Buffer | Uint8Array>;
}
