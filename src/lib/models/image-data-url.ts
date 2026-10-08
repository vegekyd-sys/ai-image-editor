/** Avoid quantified whole-payload regexes: multi-megabyte image strings can exhaust V8's regex stack. */
export function isImageBase64(value: string): boolean {
  return value.length > 0 && !/[^A-Za-z0-9+/=\r\n]/.test(value);
}

export function parseImageDataUrl(value: string): { mimeType: string; base64: string } | null {
  const comma = value.indexOf(',');
  if (comma < 0 || comma > 80) return null;
  const header = /^data:(image\/[a-z0-9.+-]+);base64,$/i.exec(value.slice(0, comma + 1));
  if (!header) return null;
  const base64 = value.slice(comma + 1);
  return isImageBase64(base64) ? { mimeType: header[1].toLowerCase(), base64 } : null;
}
