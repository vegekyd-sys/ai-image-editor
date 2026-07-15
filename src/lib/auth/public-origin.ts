import type { NextRequest } from 'next/server';

export function getPublicOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const proto = forwardedProto || url.protocol.replace(':', '') || 'http';
  const host = forwardedHost || request.headers.get('host') || url.host;
  const normalizedHost = host.replace(/^0\.0\.0\.0(?::|$)/, (match) => match.replace('0.0.0.0', '127.0.0.1'));
  return `${proto}://${normalizedHost}`;
}
