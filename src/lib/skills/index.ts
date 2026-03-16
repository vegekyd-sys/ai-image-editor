export interface SkillContext {
  currentImage: string;        // Supabase URL or base64 data URL
  originalImage?: string;      // original photo (for face restoration reference)
  referenceImages?: string[];  // user-uploaded reference images
}

export interface SkillResult {
  success: boolean;
  message: string;
  image?: string;              // base64 result image (data URL)
}
