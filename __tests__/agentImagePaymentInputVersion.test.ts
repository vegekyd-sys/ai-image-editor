// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { finalizeAgentRunForInput } from '@/lib/agent-execution-runner';

it.each([1, 2])('only commits a terminal 402 for the submitted input version (current: %i)', async version => {
  const run = { id: 'test-run', metadata: { locale: 'en' } };
  const terminal = { type: 'error' as const, code: 'image_provider_payment_required', recoverable: false, message: 'Provider returned 402.' };
  const db = createClient('https://example.com', 'fixture', {
    global: { fetch: async (url, options) => {
      const query = new URL(String(url)).searchParams;
      expect(options?.method).toBe('PATCH');
      expect(query.get('id')).toBe('eq.test-run');
      expect(query.get('status')).toBe('eq.running');
      expect(query.get('lease_token')).toBe('eq.lease');
      expect(JSON.parse(String(options?.body))).toMatchObject({ status: 'failed', metadata: { ...run.metadata, terminal } });
      return query.get('input_version') === `eq.${version}`
        ? Response.json({ id: run.id })
        : Response.json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'Cannot coerce the result to a single JSON object' }, { status: 406 });
    } },
  });
  expect(await finalizeAgentRunForInput(db, run, 'lease', 1, terminal)).toBe(version === 1 ? 'failed' : undefined);
});
