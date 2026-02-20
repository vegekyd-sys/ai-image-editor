export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;       // base64 data URL
  editPrompt?: string;  // the English editPrompt sent to generate_image (for transparency)
  timestamp: number;
  projectId?: string;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  image?: string;       // base64 for image (upload or current)
  wantImage?: boolean;  // request image generation
  aspectRatio?: string; // for recomposition edits
  reset?: boolean;      // reset session (new image upload)
}

export interface Tip {
  emoji: string;       // 1 emoji representing the edit
  label: string;       // short Chinese title (max ~10 chars)
  desc: string;        // 1-2 line Chinese description of what the edit does
  editPrompt: string;  // detailed English prompt for image generation
  category: 'enhance' | 'creative' | 'wild'; // tip category
  aspectRatio?: string; // target aspect ratio for recomposition (e.g. "4:5", "1:1", "16:9")
  previewImage?: string;    // base64 data URL of generated preview
  previewStatus?: 'pending' | 'generating' | 'done' | 'error' | 'none';
}

export interface ChatResponse {
  text: string;
  tips: Tip[];
  image?: string; // base64 edited image (if generated)
}

export interface Snapshot {
  id: string;
  image: string;          // base64
  tips: Tip[];            // tips associated with this image version
  messageId: string;      // assistant message ID for chat scroll targeting
  imageUrl?: string;      // Supabase Storage URL (persisted)
  description?: string;   // agent's analysis of this image (auto-generated, persisted)
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbSnapshot {
  id: string;
  project_id: string;
  image_url: string;
  tips: Tip[];
  message_id: string;
  sort_order: number;
  created_at: string;
  description?: string;
}

export interface DbMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant';
  content: string;
  has_image: boolean;
  created_at: string;
}
