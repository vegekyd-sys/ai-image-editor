import { isBillingEnabled, requireCredits } from './credits';
import { getTokenRate } from './token-rates';
import type { GenerateImageRequest } from '../models/types';
import { NANO_BANANA_21_MODEL } from '../models/nano-banana-21';

/** Quote the alternate independently; a Flare balance check cannot fund Nano. */
export async function authorizeImageRecovery(userId: string | undefined, request: GenerateImageRequest): Promise<boolean> {
  if (!userId || !await isBillingEnabled()) return true;
  if (request.model !== 'gemini-2.1') return false;
  const rate = await getTokenRate(NANO_BANANA_21_MODEL);
  if (!rate || rate.model_id !== NANO_BANANA_21_MODEL || !Number.isFinite(rate.markup) || rate.markup <= 0) return false;
  const images = (request.image ? 1 : 0) + (request.references?.length ?? 0);
  const outputCost = request.imageResolution === '4K' ? 0.0756 : request.imageResolution === '2K' ? 0.0504 : 0.0336;
  const check = await requireCredits(userId, Math.ceil((outputCost + images * 1120 * 1.5 / 1_000_000) * rate.markup / 0.01));
  return check.ok;
}
