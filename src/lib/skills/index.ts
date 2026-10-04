import type { ModelId, TokenUsage } from '../models/types';

export interface SkillContext {
  currentImage?: string;       // Supabase URL or base64 data URL. Omit for text-to-image.
  referenceImages?: string[];  // user-uploaded reference images
  /** Authenticated subscription route for GPT Image 2, when this caller is eligible. */
  codexSubscription?: {
    userId: string;
    projectId: string;
    agentModelId?: string;
  };
}

export interface SkillResult {
  success: boolean;
  message: string;
  image?: string;              // base64 result image (data URL)
  usedModel?: ModelId;         // which model generated the image
  contentBlocked?: boolean;    // Gemini refused content (NSFW) — caller should set isNsfw flag
  usage?: TokenUsage;             // token usage for billing
  provider?: string;              // provider that actually produced the image
}
