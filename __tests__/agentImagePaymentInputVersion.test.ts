// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { AgentDualWriter } from '@/lib/agentDualWriter';
import { normalizeExecutionSnapshot } from '@/lib/agent-execution';

it.each(['failed', 'handed_off', 'aborted'] as const)(
  'sends a live terminal error only after an atomic failure commit (%s)', async decision => {
    const terminal = { type: 'error' as const, code: 'image_provider_payment_required', recoverable: false, message: 'Provider returned 402.' };
    const requests: string[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (String(url).includes('/rpc/')) {
        expect(new URL(String(url)).pathname).toBe('/rest/v1/rpc/finalize_image_provider_rejection');
        expect(JSON.parse(String(options?.body))).toMatchObject({
          p_run_id: 'run', p_lease_token: 'lease', p_attempt_id: 'attempt', p_input_epoch: 1, p_applied_input_ids: ['prior-input'],
          p_message_id: 'message', p_content: 'Editing.\nProvider returned 402.', p_seq: 1, p_terminal: terminal,
        });
        requests.push(String(options?.body));
        if (requests.length === 1) return Response.json({ code: '55P03', message: 'lock unavailable' }, { status: 409 });
        return Response.json(decision);
      }
      return new Response(null, { status: 201 });
    });
    const db = createClient('https://example.com', 'fixture', { global: { fetch } });
    const writer = new AgentDualWriter('run', db, 'user', 'project', null, null, 'message');
    await writer.processAndEnqueue({ type: 'content', text: 'Editing.\nProvider returned 402.' });
    await writer.flush();
    const enqueue = vi.spyOn(writer, 'tryEnqueue');
    const snapshot = normalizeExecutionSnapshot({}, { objective: 'Edit text', currentWorkUnit: 'agent', nextAction: 'Handle the new input' });
    const result = await writer.finalizeImageProviderRejection({
      leaseToken: 'lease', attemptId: 'attempt', inputEpoch: 1, appliedInputIds: ['prior-input'], terminal, inputTokens: 1, outputTokens: 2,
      attemptMetadata: { inputEpoch: 1 }, handoffSnapshot: snapshot,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(result).toBe(decision);
    expect(enqueue).toHaveBeenCalledTimes(decision === 'failed' ? 1 : 0);
    if (decision === 'failed') expect(enqueue).toHaveBeenCalledWith(terminal);
  },
);
