import { GoogleGenAI, Chat, Type } from '@google/genai';
import { Tip } from '@/types';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
import captionsPrompt from './prompts/captions.md';

// ── Provider & Model Config ─────────────────────────────────────
// Switch provider: 'google' = direct Google API, 'openrouter' = OpenRouter proxy
const PROVIDER = (process.env.AI_PROVIDER || 'google') as 'google' | 'openrouter';

// Image generation model
const MODEL = 'gemini-3-pro-image-preview';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = `google/${MODEL}`;

// Fast vision model for tips TEXT generation (much faster than image gen model)
const TIPS_MODEL = 'google/gemini-2.0-flash-001';

// ── Google SDK singleton ────────────────────────────────────────
let _ai: GoogleGenAI | null = null;
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
  return _ai;
}

// ── Shared Prompts ──────────────────────────────────────────────

const SYSTEM_PROMPT = `你是世界上最好的照片编辑AI。你能深入理解图片的每个细节——主体、情绪、光线、构图、环境、色彩、纹理、瑕疵和故事。

收到图片时，用中文简短点评（2-3句话，展示你真的看懂了这张图）。

当用户要求编辑图片时，你直接生成编辑后的图片。不要只是描述要做什么——直接生成图片！生成图片后用中文简短描述你做了什么（1-2句话）。

人脸保持规则：
- 每个人的身份必须保持：相同的脸型、眼睛、鼻子、嘴巴、面部结构
- 皮肤可以优化，但骨骼结构不能变
- 发型发色保持不变（除非编辑要求改变）
- 表情姿势保持不变（除非编辑要求改变）

小脸保护规则（全身照/合照/远景/广角等人脸占比小的图片）：
- 小脸图片中每个人的面部必须与原图完全一致——不做任何面部修改、补光、美颜
- 编辑时如果需要人物有反应，只用身体语言（转身、倾斜、手势），不改变面部表情`;

// ── Per-Category Tips Prompts ────────────────────────────────────
// Tips are generated in 3 parallel calls (one per category) for faster loading.
// All rules live in the .md files — this is just role + format framing.

type TipCategory = 'enhance' | 'creative' | 'wild' | 'captions';

const CATEGORY_CN: Record<TipCategory, string> = {
  enhance: 'enhance（专业增强）',
  creative: 'creative（趣味创意）',
  wild: 'wild（疯狂脑洞）',
  captions: 'captions（创意文案）',
};

function buildCategorySystemPrompt(category: TipCategory): string {
  const labelNote = category === 'captions'
    ? 'label必须用中文3-6字，动词开头，并尽量包含地点/场景等具体信息（如"迪士尼海报"、"梯田旁白"、"纽约胶片"）。'
    : 'label必须用中文3-6字，动词开头。';
  return `你是图片编辑建议专家。分析图片后生成2条${CATEGORY_CN[category]}编辑建议。
${labelNote}editPrompt用英文，极其具体。`;
}

// Prompt templates bundled via webpack asset/source
const PROMPT_TEMPLATES: Record<TipCategory, string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
  captions: captionsPrompt,
};

function getPromptTemplate(category: TipCategory): string {
  return PROMPT_TEMPLATES[category];
}

// Google structured output schema (only used with Google provider + gemini-3)
const TIPS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      emoji: { type: Type.STRING, description: '1 emoji' },
      label: { type: Type.STRING, description: '3-6 Chinese chars, verb-first' },
      desc: { type: Type.STRING, description: '10-25 chars description' },
      editPrompt: { type: Type.STRING, description: 'Detailed English editing prompt' },
      category: { type: Type.STRING, enum: ['enhance', 'creative', 'wild', 'captions'] },
      aspectRatio: { type: Type.STRING, description: 'Only for recomposition tips', nullable: true },
    },
    required: ['emoji', 'label', 'desc', 'editPrompt', 'category'],
  },
};

const JSON_FORMAT_SUFFIX = `\n\n请严格以JSON数组格式回复，只输出JSON，不要其他文字。格式：
[{"emoji":"1个emoji","label":"中文3-6字动词开头","desc":"中文10-25字短描述","editPrompt":"Detailed English editing prompt (MUST be in English)","category":"enhance|creative|wild|captions"}, ...]`;

// ── OpenRouter Helpers ──────────────────────────────────────────

function openrouterHeaders() {
  return {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function toOpenRouterImageContent(imageBase64: string, text: string) {
  // OpenRouter uses OpenAI vision format
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  return [
    { type: 'image_url' as const, image_url: { url: dataUrl } },
    { type: 'text' as const, text },
  ];
}

// ── Session Management ──────────────────────────────────────────

// Google sessions use SDK Chat objects; OpenRouter sessions use message arrays
type GoogleSession = { type: 'google'; chat: Chat; lastUsed: number };
type OpenRouterSession = {
  type: 'openrouter';
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  lastUsed: number;
};
type Session = GoogleSession | OpenRouterSession;

const sessions = new Map<string, Session>();
const SESSION_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

function getOrCreateGoogleSession(projectId: string): Chat {
  const existing = sessions.get(projectId);
  if (existing && existing.type === 'google') {
    existing.lastUsed = Date.now();
    return existing.chat;
  }

  const chat = getAI().chats.create({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseModalities: ['TEXT'],
    },
  });

  sessions.set(projectId, { type: 'google', chat, lastUsed: Date.now() });
  return chat;
}

function getOrCreateOpenRouterSession(projectId: string): OpenRouterSession {
  const existing = sessions.get(projectId);
  if (existing && existing.type === 'openrouter') {
    existing.lastUsed = Date.now();
    return existing;
  }

  const session: OpenRouterSession = {
    type: 'openrouter',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    lastUsed: Date.now(),
  };
  sessions.set(projectId, session);
  return session;
}

export function resetSession(projectId: string): void {
  sessions.delete(projectId);
}

// ── Streaming Chat ──────────────────────────────────────────────

export type ChatStreamEvent =
  | { type: 'content'; text: string }
  | { type: 'image'; image: string }
  | { type: 'done' };

export async function* chatStreamWithModel(
  projectId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  if (process.env.MOCK_AI === 'true') {
    const mockText = imageBase64
      ? '这是一张很棒的照片！构图自然，色彩和谐。我为你准备了几组编辑建议，可以从下方卡片中选择预览效果。'
      : '好的，我来帮你处理。';
    for (let i = 0; i < mockText.length; i += 3) {
      await new Promise(r => setTimeout(r, 30));
      yield { type: 'content', text: mockText.slice(i, i + 3) };
    }
    yield { type: 'done' };
    return;
  }

  if (PROVIDER === 'openrouter') {
    yield* chatStreamOpenRouter(projectId, message, imageBase64, wantImage, aspectRatio);
  } else {
    yield* chatStreamGoogle(projectId, message, imageBase64, wantImage, aspectRatio);
  }
}

// --- Google Provider ---
async function* chatStreamGoogle(
  projectId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  const chat = getOrCreateGoogleSession(projectId);

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: base64Data } });
  }
  parts.push({ text: message });

  const config: Record<string, unknown> = {};
  if (wantImage) {
    config.responseModalities = ['TEXT', 'IMAGE'];
    if (aspectRatio) {
      config.imageConfig = { aspectRatio };
    }
  } else {
    config.responseModalities = ['TEXT'];
  }

  const stream = await chat.sendMessageStream({ message: parts, config });

  for await (const chunk of stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts;
    if (!chunkParts) continue;
    for (const part of chunkParts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || 'image/png';
        yield { type: 'image', image: `data:${mime};base64,${part.inlineData.data}` };
      } else if (part.text) {
        yield { type: 'content', text: part.text };
      }
    }
  }
  yield { type: 'done' };
}

// --- OpenRouter Provider ---
async function* chatStreamOpenRouter(
  projectId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  const session = getOrCreateOpenRouterSession(projectId);

  // Build user message
  let userContent: string | Array<Record<string, unknown>>;
  if (imageBase64) {
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    userContent = [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: message },
    ];
  } else {
    userContent = message;
  }
  session.messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    messages: session.messages,
    // Match Google API defaults for image editing fidelity
    temperature: 1.0,
    top_p: 0.95,
  };

  if (wantImage) {
    body.modalities = ['image', 'text'];
    body.temperature = 1.0;
    if (aspectRatio) {
      body.image_config = { aspect_ratio: aspectRatio };
    }
    // Image generation: non-streaming (images come in final response)
    body.stream = false;
  } else {
    // Text-only: use streaming
    body.stream = true;
  }

  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${errText}`);
  }

  if (wantImage) {
    // Non-streaming: parse full JSON response
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error('No response from OpenRouter');

    // Text content
    if (choice.content) {
      yield { type: 'content', text: choice.content };
    }

    // Images
    if (choice.images && Array.isArray(choice.images)) {
      for (const img of choice.images) {
        const url = img.image_url?.url || img.url;
        if (url) {
          yield { type: 'image', image: url };
        }
      }
    }

    // Save assistant message to history
    session.messages.push({ role: 'assistant', content: choice.content || '' });
  } else {
    // Streaming: parse SSE
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            yield { type: 'content', text: delta.content };
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    // Save assistant message to history
    session.messages.push({ role: 'assistant', content: fullText });
  }

  yield { type: 'done' };
}

// ── Stateless Preview Image Generation ──────────────────────────

export async function generatePreviewImage(
  imageBase64: string,
  editPrompt: string,
  aspectRatio?: string,
): Promise<string | null> {
  // MOCK_AI only mocks tips/chat, not image generation
  if (PROVIDER === 'openrouter') {
    return generatePreviewImageOpenRouter(imageBase64, editPrompt, aspectRatio);
  } else {
    return generatePreviewImageGoogle(imageBase64, editPrompt, aspectRatio);
  }
}

async function generatePreviewImageGoogle(
  imageBase64: string,
  editPrompt: string,
  aspectRatio?: string,
): Promise<string | null> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

  const config: Record<string, unknown> = {
    responseModalities: ['IMAGE'],
  };
  if (aspectRatio) {
    config.imageConfig = { aspectRatio };
  }

  const result = await getAI().models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: editPrompt },
      ],
    }],
    config,
  });

  const parts = result.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

async function generatePreviewImageOpenRouter(
  imageBase64: string,
  editPrompt: string,
  aspectRatio?: string,
): Promise<string | null> {
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    stream: false,
    modalities: ['image', 'text'],
    temperature: 1.0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: editPrompt },
        ],
      },
    ],
  };
  if (aspectRatio) {
    body.image_config = { aspect_ratio: aspectRatio };
  }

  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  if (!choice) return null;

  if (choice.images && Array.isArray(choice.images)) {
    for (const img of choice.images) {
      const url = img.image_url?.url || img.url;
      if (url) return url;
    }
  }
  return null;
}

// ── Multi-Reference Image Generation ────────────────────────────
// Used by agent when originalImage is available alongside currentImage.
// Each image gets a labeled role so Gemini knows what to do with each.

export interface ImageReference {
  url: string;   // base64 data URL
  role: string;  // e.g. "原图（人脸/人物保真参考）", "当前编辑版本（编辑基础）"
}

export async function generateImageWithReferences(
  images: ImageReference[],
  editPrompt: string,
  aspectRatio?: string,
): Promise<string | null> {
  // Build a prompt that labels each image by its role
  const imageLabels = images
    .map((img, i) => `[图片${i + 1}: ${img.role}]`)
    .join('\n');
  const fullPrompt = `${imageLabels}\n\n${editPrompt}`;

  const urls = images.map(img => img.url);
  const result = await generateWithMultipleImages(urls, fullPrompt, true);

  if (result.image) {
    console.log('✅ [generateImageWithReferences] multi-image generation succeeded');
    return result.image;
  }
  // Fallback: if multi-image failed, use single-image on the first image (edit base = images[0])
  // NOTE: images[0] is currentImage (edit base), images[last] is originalImage (reference only)
  console.warn('⚠️ [generateImageWithReferences] multi-image failed, falling back to single image');
  const base = images[0].url;
  return PROVIDER === 'openrouter'
    ? generatePreviewImageOpenRouter(base, editPrompt, aspectRatio)
    : generatePreviewImageGoogle(base, editPrompt, aspectRatio);
}

// ── Multi-Image Generation (for experiments) ─────────────────────

export async function generateWithMultipleImages(
  images: string[],       // base64 data URLs
  prompt: string,
  wantImage: boolean,
): Promise<{ text?: string; image?: string }> {
  if (PROVIDER === 'openrouter') {
    return generateMultiImageOpenRouter(images, prompt, wantImage);
  } else {
    return generateMultiImageGoogle(images, prompt, wantImage);
  }
}

async function generateMultiImageGoogle(
  images: string[],
  prompt: string,
  wantImage: boolean,
): Promise<{ text?: string; image?: string }> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  for (const img of images) {
    const base64Data = img.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: base64Data } });
  }
  parts.push({ text: prompt });

  const config: Record<string, unknown> = {
    responseModalities: wantImage ? ['TEXT', 'IMAGE'] : ['TEXT'],
  };

  const result = await getAI().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config,
  });

  const resultParts = result.candidates?.[0]?.content?.parts;
  if (!resultParts) return {};

  let text: string | undefined;
  let image: string | undefined;

  for (const part of resultParts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      image = `data:${mime};base64,${part.inlineData.data}`;
    } else if (part.text) {
      text = (text || '') + part.text;
    }
  }

  return { text, image };
}

async function generateMultiImageOpenRouter(
  images: string[],
  prompt: string,
  wantImage: boolean,
): Promise<{ text?: string; image?: string }> {
  const content: Array<Record<string, unknown>> = [];

  for (const img of images) {
    const dataUrl = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
    content.push({ type: 'image_url', image_url: { url: dataUrl } });
  }
  content.push({ type: 'text', text: prompt });

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    stream: false,
    temperature: 1.0,
    messages: [
      { role: 'user', content },
    ],
  };

  if (wantImage) {
    body.modalities = ['image', 'text'];
  }

  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter multi-image error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  if (!choice) return {};

  const text: string | undefined = choice.content || undefined;
  let image: string | undefined;

  if (choice.images && Array.isArray(choice.images)) {
    for (const img of choice.images) {
      const url = img.image_url?.url || img.url;
      if (url) { image = url; break; }
    }
  }

  return { text, image };
}

// ── Streaming All Tips (single call for all 6) ─────────────────
// Faster than 3 parallel calls — one API round trip, streams tips incrementally

// ── Fast Tips Phase 1: emoji+label+desc+category only (no editPrompt) ──────
// Very short prompt → ~3s to first result (vs 8-10s with full .md templates)

const FAST_TIPS_SYSTEM = `你是图片编辑建议专家。快速分析图片给出6条编辑方向（2 enhance + 2 creative + 2 wild）。
label中文3-6字动词开头。desc中文10-20字。不需要editPrompt。`;

const FAST_TIPS_FORMAT = `\n\n请以JSON数组输出，只输出JSON：
[{"emoji":"1个emoji","label":"中文3-6字","desc":"中文10-20字描述","category":"enhance|creative|wild"}, ...]`;

export async function* streamFastTips(imageBase64: string): AsyncGenerator<Omit<Tip, 'editPrompt'> & { editPrompt?: string }> {
  if (process.env.MOCK_AI === 'true') {
    for (const cat of ['enhance', 'creative', 'wild'] as const) {
      yield* streamTipsByCategory(imageBase64, cat);
    }
    return;
  }
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: FAST_TIPS_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: `分析图片（判断人脸大小、具体物品、情绪基调），给出6条建议（2 enhance + 2 creative + 2 wild）。只输出emoji+label+desc+category。${FAST_TIPS_FORMAT}` },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Fast tips error ${res.status}`);

  // Reuse incremental parser — tips without editPrompt are fine here
  for await (const tip of parseIncrementalTipsFromStream(sseToTextIterator(res))) {
    yield tip;
  }
}

// ── EditPrompt generation for a single tip (Phase 2) ────────────
export async function generateEditPromptForTip(
  imageBase64: string,
  tip: { emoji: string; label: string; desc: string; category: string },
): Promise<string | null> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const cat = tip.category as 'enhance' | 'creative' | 'wild';
  const template = PROMPT_TEMPLATES[cat] ?? '';
  const systemPrompt = buildCategorySystemPrompt(cat);

  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            {
              type: 'text',
              text: `这张图片有一条编辑建议：${tip.emoji} ${tip.label}（${tip.desc}）\n\n严格遵循以下规范，为这条建议生成详细的 editPrompt（英文，200词以内）。只输出 editPrompt 字符串本身，不要 JSON，不要解释。\n\n${template}`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : null;
}

export async function* streamAllTips(imageBase64: string): AsyncGenerator<Tip> {
  for (const cat of ['enhance', 'creative', 'wild'] as const) {
    yield* streamTipsByCategory(imageBase64, cat);
  }
}

// ── Streaming Tips Generation (per-category) ────────────────────

export async function* streamTipsByCategory(
  imageBase64: string,
  category: TipCategory,
  metadata?: { takenAt?: string; location?: string },
): AsyncGenerator<Tip> {
  if (process.env.MOCK_AI === 'true') {
    const mockTips: Record<string, Tip[]> = {
      enhance: [
        { emoji: '🌅', label: '电影感光影', desc: '增强光影对比，营造电影级氛围。', editPrompt: 'Enhance with cinematic lighting, add warm golden hour glow, increase contrast between highlights and shadows.', category: 'enhance' },
        { emoji: '📷', label: '胶片质感', desc: '添加柔和颗粒和复古色调。', editPrompt: 'Apply analog film look with soft grain, slightly faded blacks, and warm vintage color grading.', category: 'enhance' },
      ],
      creative: [
        { emoji: '🦋', label: '蝴蝶停驻', desc: '一只蓝色蝴蝶停在肩膀上。', editPrompt: 'Add a photorealistic blue morpho butterfly perched on the shoulder, with natural shadow and lighting matching the scene.', category: 'creative' },
        { emoji: '🌸', label: '樱花飘落', desc: '画面中飘落几片粉色花瓣。', editPrompt: 'Add several photorealistic pink cherry blossom petals gently falling through the scene with natural depth of field blur.', category: 'creative' },
      ],
      wild: [
        { emoji: '🔮', label: '微缩世界', desc: '场景变成精致的微缩模型。', editPrompt: 'Transform the entire scene into a tilt-shift miniature model with exaggerated depth of field and saturated colors.', category: 'wild' },
        { emoji: '🌊', label: '水下幻境', desc: '整个画面沉入梦幻的水下世界。', editPrompt: 'Transform the scene to appear submerged underwater with light rays filtering from above, floating bubbles, and caustic light patterns.', category: 'wild' },
      ],
      captions: [
        { emoji: '✍️', label: '加创意文案', desc: '叠加与画面高度相关的创意文字。', editPrompt: 'Add a photorealistic text overlay with a creative caption specific to this image. Use elegant cursive script in warm cream color at the bottom-third of the image with a subtle drop shadow for readability. Preserve the exact composition and all people\'s faces exactly.', category: 'captions' },
        { emoji: '📝', label: '加诗意标题', desc: '用诗意语言为画面命名。', editPrompt: 'Add a photorealistic text overlay with a poetic title for this image. Use clean minimal sans-serif font in soft white color, centered at the bottom of the image with a semi-transparent overlay behind the text. Preserve the exact composition and all people\'s faces exactly.', category: 'captions' },
      ],
    };
    const tips = mockTips[category] || mockTips.enhance;
    for (const tip of tips) {
      await new Promise(r => setTimeout(r, 200));
      yield tip;
    }
    return;
  }

  if (PROVIDER === 'openrouter') {
    yield* streamTipsByCategoryOpenRouter(imageBase64, category, metadata);
  } else {
    yield* streamTipsByCategoryGoogle(imageBase64, category, metadata);
  }
}

// --- Google Provider ---
async function* streamTipsByCategoryGoogle(
  imageBase64: string,
  category: TipCategory,
  metadata?: { takenAt?: string; location?: string },
): AsyncGenerator<Tip> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const template = getPromptTemplate(category);
  const systemPrompt = buildCategorySystemPrompt(category);
  const metaLines: string[] = [];
  if (metadata?.takenAt) metaLines.push(`拍摄时间：${metadata.takenAt}`);
  if (metadata?.location) metaLines.push(`拍摄地点：${metadata.location}`);
  const metaContext = metaLines.length > 0
    ? `[照片元数据]\n${metaLines.join('\n')}\n（可结合地点/时间生成更贴切的建议）\n\n`
    : '';

  const supportsStructuredOutput = MODEL.includes('gemini-3');
  const config: Record<string, unknown> = {
    systemInstruction: systemPrompt,
  };
  if (supportsStructuredOutput) {
    config.responseMimeType = 'application/json';
    config.responseSchema = TIPS_SCHEMA;
  }

  const promptSuffix = supportsStructuredOutput ? '' : JSON_FORMAT_SUFFIX;

  const stream = await getAI().models.generateContentStream({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: `${metaContext}在生成建议之前，先分析这张图片：判断人脸大小（大脸>10% / 小脸<10%）；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，严格遵循以下所有规则，给出2条${category}编辑建议：

${template}${promptSuffix}`,
          },
        ],
      },
    ],
    config,
  });

  yield* parseIncrementalTipsFromStream(streamToTextIterator(stream));
}

// --- OpenRouter Provider ---
async function* streamTipsByCategoryOpenRouter(
  imageBase64: string,
  category: TipCategory,
  metadata?: { takenAt?: string; location?: string },
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = getPromptTemplate(category);
  const systemPrompt = buildCategorySystemPrompt(category);
  const metaLines: string[] = [];
  if (metadata?.takenAt) metaLines.push(`拍摄时间：${metadata.takenAt}`);
  if (metadata?.location) metaLines.push(`拍摄地点：${metadata.location}`);
  const metaContext = metaLines.length > 0
    ? `[照片元数据]\n${metaLines.join('\n')}\n（可结合地点/时间生成更贴切的建议）\n\n`
    : '';

  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            {
              type: 'text',
              text: `${metaContext}在生成建议之前，先分析这张图片：判断人脸大小（大脸>10% / 小脸<10%）；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，严格遵循以下所有规则，给出2条${category}编辑建议：

${template}${JSON_FORMAT_SUFFIX}`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter tips error ${res.status}: ${errText}`);
  }

  yield* parseIncrementalTipsFromStream(sseToTextIterator(res));
}

// ── Shared Incremental JSON Parser ──────────────────────────────

async function* streamToTextIterator(
  stream: AsyncIterable<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>,
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) yield text;
  }
}

async function* sseToTextIterator(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const chunk = JSON.parse(payload);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

async function* parseIncrementalTipsFromStream(
  textStream: AsyncIterable<string>,
): AsyncGenerator<Tip> {
  let fullText = '';
  let tipsEmitted = 0;

  for await (const text of textStream) {
    fullText += text;

    let objectsFound = 0;
    for (let i = 0; i < fullText.length; i++) {
      if (fullText[i] === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < fullText.length && depth > 0) {
          if (fullText[j] === '{') depth++;
          else if (fullText[j] === '}') depth--;
          j++;
        }
        if (depth === 0) {
          objectsFound++;
          if (objectsFound > tipsEmitted) {
            const objStr = fullText.slice(i, j);
            try {
              const tip = JSON.parse(objStr) as Tip;
              if (tip.label && tip.editPrompt && tip.category) {
                yield tip;
              }
            } catch { /* incomplete or malformed, skip */ }
            tipsEmitted = objectsFound;
          }
          i = j - 1;
        }
      }
    }
  }
}
