export type EditableType = 'text' | 'image' | 'video';

export interface EditableField {
  id: string;           // data-editable value, e.g. "title"
  type: EditableType;
  label: string;        // UI label, e.g. "标题"
  propKey: string;      // prop key for text content, e.g. "title"
  trimBeforePropKey?: string; // video trim start, in frames
  trimAfterPropKey?: string;  // video trim end, in frames
}

export interface DesignPayload {
  code: string;
  width: number;
  height: number;
  props?: Record<string, unknown>;
  animation?: { fps: number; durationInSeconds: number; format?: string };
  editables?: EditableField[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;        // base64 data URL (single image, e.g. generate_image result)
  images?: string[];     // multiple images (e.g. preview_frame captures)
  imageCaptions?: string[]; // optional labels for images, e.g. captured video frame time
  editPrompt?: string;   // the English editPrompt sent to generate_image (for transparency)
  editModel?: string;    // which model generated the image ('gemini' | 'qwen')
  editInputImages?: string[]; // images passed to Gemini as input (1 = normal, 2 = face restoration)
  design?: DesignPayload; // Remotion design from run_code
  thinking?: string[];   // Agent's reasoning/thinking segments (one per thinking round)
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
  tipKey?: string;     // unique key within snapshot (category-N), used for dedup instead of label
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
  type?: 'original' | 'edit' | 'reference' | 'video';
  design?: DesignPayload;
  designPath?: string;
  videoMeta?: VideoMeta;
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
  design_path?: string;
  video_meta?: VideoMeta;
  metadata?: PhotoMetadata;
}

export interface DbMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant';
  content: string;
  has_image: boolean;
  created_at: string;
}

export type VideoModel = string
export type VideoResolution = '480p' | '720p' | '1080p' | '4k' | 'auto'
export type VideoAspectRatio = 'auto' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3'

export interface TranscriptWord {
  text: string;
  startMs: number | null;
  endMs: number | null;
  confidence?: number | null;
}

export interface TranscriptUtterance {
  text: string;
  startMs: number | null;
  endMs: number | null;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface VideoTranscript {
  provider: string;
  model: string;
  resourceId?: string;
  requestId?: string;
  text: string;
  durationMs: number | null;
  utterances: TranscriptUtterance[];
  sourceUrl?: string;
  extractedAudio?: boolean;
  createdAt?: string;
}

export interface ArtifactCompletionAction {
  label: string;
  prompt: string;
  description?: string;
  policy?: 'confirm' | 'auto';
}

export interface VideoMeta {
  taskId: string | null;
  videoUrl: string | null;
  providerUrl?: string;
  videoPath?: string;
  prompt: string;
  sourceSnapshotIds: string[];
  sourceUrls: string[];
  status: 'processing' | 'completed' | 'failed' | 'abandoned';
  duration: number | null;
  model: VideoModel;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  providerModel?: string;
  providerMode?: string;
  providerCostUsd?: number;
  createdAt?: string;
  error?: string;
  width?: number;
  height?: number;
  creditsCharged?: number;
  refunded?: boolean;
  transcript?: VideoTranscript;
  completionActions?: ArtifactCompletionAction[];
}


export interface ProjectAnimation {
  id: string;
  projectId: string;
  taskId: string | null;
  videoUrl: string | null;
  prompt: string;
  snapshotUrls: string[];
  imageUrl?: string;
  status: 'processing' | 'completed' | 'failed' | 'abandoned';
  duration?: number | null;
  createdAt: string;
  videoModel?: VideoModel;
  videoResolution?: VideoResolution;
  videoAspectRatio?: VideoAspectRatio;
  error?: string;
}
