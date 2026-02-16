export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64 data URL
  timestamp: number;
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
}
