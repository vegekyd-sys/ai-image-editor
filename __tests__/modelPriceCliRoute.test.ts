import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/billing/model-prices/route';
import { seededMediaPrices } from './helpers/media-prices';

const db = vi.hoisted(() => ({ reads: [] as string[], prices: [] as unknown[], authenticatedHash: '' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getSession: async () => ({ data: { session: null } }) },
}) }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    db.reads.push(table);
    if (table === 'api_keys') {
      let hash: string;
      const keyQuery = {
        select: () => keyQuery,
        eq: (column: string, value: string) => { if (column === 'key_hash') hash = value; return keyQuery; },
        single: async () => ({ data: hash === db.authenticatedHash ? { id: 'fixture-key', user_id: 'fixture-user' } : null }),
      };
      return keyQuery;
    }
    if (table === 'media_pricing') return { select: () => ({ order: async () => ({ data: db.prices }) }) };
    throw new Error(`Unexpected database access for quote: ${table}`);
  },
}) }));

const key = 'mk_live_fixture';
const payload = { requests: [{ kind: 'video', model: 'kling-4-flash', resolution: '720p', duration_seconds: 5, image_count: 0 }] };
function request(body: unknown, token?: string) {
  return new Request('https://unit.test/api/billing/model-prices', {
    method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  db.reads = [];
  db.prices = seededMediaPrices();
  db.authenticatedHash = createHash('sha256').update(key).digest('hex');
});

it('authenticates a CLI key and quotes credits without touching balances or updating the key', async () => {
  const response = await POST(request(payload, key));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-credits-remaining')).toBeNull();
  const result = await response.json();
  expect(result).toMatchObject({ currency: 'credits', estimates: [{ status: 'estimated', credits: 94 }] });
  expect(JSON.stringify(result)).not.toMatch(/supplier|markup|usd/i);
  expect(new Set(db.reads)).toEqual(new Set(['api_keys', 'media_pricing']));
});

it('authenticates before reading prices and rejects malformed requests before quoting', async () => {
  expect((await POST(request(payload))).status).toBe(401);
  expect((await POST(request(payload, 'mk_live_unknown'))).status).toBe(401);
  const invalid = await POST(request({ requests: [{ ...payload.requests[0], image_count: -1 }] }, key));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ invalidFields: ['requests.0.image_count'] });
  expect(db.reads).toEqual(['api_keys', 'api_keys']);
});

it('lists capability IDs without reading a pricing row', async () => {
  const response = await POST(request({ requests: [] }, key));
  expect(await response.json()).toMatchObject({ currency: 'credits', catalog: { video: expect.arrayContaining([{ model: 'kling-4-flash', resolutions: ['720p'], minSeconds: 3, maxSeconds: 20 }]) } });
  expect(db.reads).toEqual(['api_keys']);
});
