export interface DesignPayload {
  code: string;
  width: number;
  height: number;
  props?: Record<string, unknown>;
  animation?: { fps: number; durationInSeconds: number; format?: string };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;        // base64 data URL
  editPrompt?: string;   // the English editPrompt sent to generate_image (for transparency)
  editModel?: string;    // which model generated the image ('gemini' | 'qwen')
  editInputImages?: string[]; // images passed to Gemini as input (1 = normal, 2 = face restoration)
  design?: DesignPayload; // Remotion design from run_code
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
  category: 'enhance' | 'creative' | 'wild' | 'captions'; // tip category
  aspectRatio?: string; // target aspect ratio for recomposition (e.g. "4:5", "1:1", "16:9")
  previewImage?: string;    // base64 data URL of generated preview
  previewStatus?: 'pending' | 'generating' | 'done' | 'error' | 'none';
}

export interface ChatResponse {
  text: string;
  tips: Tip[];
  image?: string; // base64 edited image (if generated)
}

export interface PhotoMetadata {
  takenAt?: string;    // e.g. "2024年12月25日 下午14:30"
  location?: string;   // e.g. "台北市信义区, 台湾"
  raw?: {
    lat?: number;
    lng?: number;
    datetime?: string;
  };
}

// ── Annotation types ──
export interface BrushData { points: { x: number; y: number }[] }
export interface RectData { x: number; y: number; w: number; h: number }
export interface TextData { x: number; y: number; text: string; fontSize: number; textColor?: string; bgColor?: string }
export interface AnnotationEntry {
  id: string;
  type: 'brush' | 'rect' | 'text';
  data: BrushData | RectData | TextData;
  color: string;
  lineWidth: number;
}

export interface Snapshot {
  id: string;
  image: string;          // base64
  tips: Tip[];            // tips associated with this image version
  messageId: string;      // assistant message ID for chat scroll targeting
  imageUrl?: string;      // Supabase Storage URL (persisted)
  description?: string;   // agent's analysis of this image (auto-generated, persisted)
  metadata?: PhotoMetadata; // EXIF metadata (location, time)
  type?: 'original' | 'edit' | 'reference'; // snapshot kind — reference = skill asset
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
  type?: string;
}

export interface DbMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant';
  content: string;
  has_image: boolean;
  created_at: string;
}

export interface ProjectAnimation {
  id: string;
  projectId: string;
  taskId: string | null;
  videoUrl: string | null;
  prompt: string;
  snapshotUrls: string[];
  status: 'processing' | 'completed' | 'failed' | 'abandoned';
  duration?: number | null;
  createdAt: string;
}
