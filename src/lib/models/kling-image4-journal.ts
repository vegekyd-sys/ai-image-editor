import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KlingImage4RequestError, type KlingImage4Receipt } from './kling-image4';
import type { GenerateImageRequest } from './types';

/**
 * Atomic Storage insert prevents duplicate paid POSTs for a stable tool/request ID.
 * Only hashes and provider receipts are stored; no prompts, input URLs or credentials.
 * A lost claim/POST/debit response is deliberately not retried. It needs reconciliation.
 * This uses the existing bucket and does not create a shared pricing row or new schema.
 */
export function createKlingImage4Journal(client: SupabaseClient, userId: string, requestId: string): Pick<GenerateImageRequest, 'beforeKlingImage4Submit' | 'onKlingImage4Receipt'> {
  if (!userId || !requestId || requestId.length > 200) throw new KlingImage4RequestError('A stable authenticated request ID is required; nothing was submitted.');
  const id = createHash('sha256').update(`${userId}\0${requestId}`).digest('hex');
  const root = `workspace/${userId}/kling-image4/${id}`;
  const bucket = client.storage.from('images');
  return {
    beforeKlingImage4Submit: async request => {
      const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      const { error } = await bucket.upload(`${root}/intent.json`, JSON.stringify({ fingerprint, endpoint: request.endpoint, createdAt: new Date().toISOString() }), { contentType: 'application/json', upsert: false });
      if (!error) return;
      // Read only. Never reinterpret an uncertain write as permission to submit.
      const existing = await bucket.download(`${root}/receipt.json`);
      let receipt: KlingImage4Receipt | undefined;
      try { if (existing.data) receipt = JSON.parse(await existing.data.text()); } catch { /* retain uncertain state */ }
      throw new KlingImage4RequestError(receipt
        ? `This request already has a ${receipt.status} receipt; no new generation or debit was started.`
        : 'Request claim exists or could not be confirmed; do not submit again. Inspect the durable intent before recovery.', receipt?.taskId);
    },
    onKlingImage4Receipt: async receipt => {
      const { error } = await bucket.upload(`${root}/receipt.json`, JSON.stringify({ ...receipt, updatedAt: new Date().toISOString() }), { contentType: 'application/json', upsert: true });
      if (error) throw new KlingImage4RequestError('Could not save the accepted task receipt.', receipt.taskId);
    },
  };
}
