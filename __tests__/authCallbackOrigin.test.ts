import { describe, expect, it } from 'vitest';
import { getPublicOrigin } from '@/lib/auth/public-origin';

describe('auth callback public origin', () => {
  it('normalizes local 0.0.0.0 callback redirects to a browser-reachable host', () => {
    const request = new Request('http://0.0.0.0:3001/api/auth/callback?code=test', {
      headers: { host: '0.0.0.0:3001' },
    });

    expect(getPublicOrigin(request as never)).toBe('http://127.0.0.1:3001');
  });

  it('prefers forwarded host when the app is behind a proxy', () => {
    const request = new Request('http://0.0.0.0:3001/api/auth/callback?code=test', {
      headers: {
        host: '0.0.0.0:3001',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'www.makaron.app',
      },
    });

    expect(getPublicOrigin(request as never)).toBe('https://www.makaron.app');
  });
});
