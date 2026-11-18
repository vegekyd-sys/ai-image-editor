import { isBillingEnabled, requireCredits } from './credits';
import { imageAdmissionCredits } from './image-pricing';
import { imagePricingInput } from './image-pricing-policy';
import type { GenerateImageRequest } from '../models/types';

/** Quote the alternate independently; a Flare balance check cannot fund Nano. */
export async function authorizeImageRecovery(userId: string | undefined, request: GenerateImageRequest): Promise<boolean> {
  if (!userId || !await isBillingEnabled()) return true;
  if (request.model !== 'gemini-2.1') return false;
  try {
    const credits = await imageAdmissionCredits(request.model, imagePricingInput(request));
    return (await requireCredits(userId, credits)).ok;
  } catch {
    return false;
  }
}
