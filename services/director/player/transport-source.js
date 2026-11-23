import { createFalClient } from '@fal-ai/director-client';
import { wma } from '@fal-ai/director-client/realtime';

export function openDirector(proxyUrl, token, callbacks) {
  const client = createFalClient({
    proxyUrl,
    fetch(input, init) {
      if (new URL(input, location.href).href !== proxyUrl) throw Error('Unexpected signaling origin');
      const headers = new Headers(init?.headers);
      headers.set('x-director-player', token);
      return fetch(input, { ...init, headers, redirect: 'error' });
    },
  });
  return client.realtime.open(wma('minimax/h3-max/director'), {
    receive: ['video', 'audio'],
    negotiationTimeoutMs: 90000,
    ...callbacks,
  });
}
