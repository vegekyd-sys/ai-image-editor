import type { ModelId } from '../models/types';

export interface SkillContext {
  currentImage?: string;       // Supabase URL or base64 data URL. Omit for text-to-image.
  originalImage?: string;      // original photo (for face restoration reference)
  referenceImages?: string[];  // user-uploaded reference images
}

export interface SkillResult {
  success: boolean;
  message: string;
  image?: string;              // base64 result image (data URL)
  usedModel?: ModelId;         // which model generated the image
  contentBlocked?: boolean;    // Gemini refused content (NSFW) — caller should set isNsfw flag
}
