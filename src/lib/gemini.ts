import { GoogleGenAI, Chat, Type } from '@google/genai';
import { Tip } from '@/types';
import fs from 'fs';
import path from 'path';

// ── Provider & Model Config ─────────────────────────────────────
// Switch provider: 'google' = direct Google API, 'openrouter' = OpenRouter proxy
const PROVIDER = (process.env.AI_PROVIDER || 'google') as 'google' | 'openrouter';

// Model name (same for both providers, OpenRouter prefixes with 'google/')
const MODEL = 'gemini-3-pro-image-preview';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = `google/${MODEL}`;

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

type TipCategory = 'enhance' | 'creative' | 'wild';

const CATEGORY_INFO: Record<TipCategory, { cn: string; definition: string; selfCheck: string; rules: string }> = {
  enhance: {
    cn: 'enhance（专业增强）',
    definition: 'enhance = 让照片整体变好看（光影/色彩/通透感），变化必须肉眼明显',
    selfCheck: `enhance自检：
- 放在原图旁边，任何人都能一眼看出提升吗？（"看不出变化"=3分）
- 风格与照片情绪匹配吗？（搞笑照片配阴沉暗调=4分）
- 有通透感+景深分离+色调层次吗？
- enhance可以调整构图，但必须基于原图——编辑后还能一眼认出是同一张照片（"画面变化太多了"=3分）
- 编辑后的背景还是原图的背景吗？enhance是提升原图不是生成新图（"背景被换掉了"=3分，"人物都变了"=1分）`,
    rules: `⚠️ enhance的editPrompt必须包含背景锚定：
"Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."`,
  },
  creative: {
    cn: 'creative（趣味创意）',
    definition: 'creative = 往画面里加入一个与画面内容有因果关系的有趣新元素',
    selfCheck: `creative自检（三问全过才输出）：
- Q1 为什么是这个元素？能不能一句话说清"因为画面里有X所以加Y"？说不清=换一个
- Q2 情绪对吗？让人笑/惊喜=好，让人害怕/困惑=换
- Q3 这个创意能用在其他照片上吗？能=太通用=换一个`,
    rules: `creative品质标准：
- 加入的动物/角色必须是photorealistic写实风（cartoon/卡通=贴纸感）
- 足够大且显眼，至少占画面5-10%面积
- 必须与人物有互动/眼神交流，不能像贴纸`,
  },
  wild: {
    cn: 'wild（疯狂脑洞）',
    definition: 'wild = 让画面中已有的物品发生疯狂变化（不是加新东西！）',
    selfCheck: `wild自检（四问全过才输出）：
- Q1 变化的主角是画面中已有的什么东西？指不出来=不是wild
- Q2 变化够大吗？一眼就能看到变化=好。改镜片/眼镜反射内容=太小不够大(3分"眼镜idea傻")
- Q3 变化是基于物品本身特点还是随便套的？表面视觉类比（层状=蛋糕/抹茶、圆形=球）=换一个。"变成食物/饮品"除非厨房场景否则=万金油套路
- Q4 这个变化会不会让人不适/恐怖？（超长舌头=3分"有点吓人"、身体扭曲变形=不适）→ 换一个有趣的方向`,
    rules: `wild额外规则：只选画面中重要/显眼的元素做变化，不要选边缘模糊的小物件`,
  },
};

function buildCategorySystemPrompt(category: TipCategory): string {
  const info = CATEGORY_INFO[category];
  return `你是图片编辑建议专家。分析图片后生成2条${info.cn}编辑建议。label必须用中文3-6字，动词开头。editPrompt用英文，极其具体。

${info.definition}

⚠️ 第一步：判断人脸大小！
分析图片时首先判断人脸在画面中的占比：
- 大脸（特写/半身照，脸部占画面>10%）→ 正常处理
- 小脸（全身照/合照/远景/广角，脸部占画面<10%）→ 触发小脸保护模式
小脸保护模式下所有editPrompt必须包含：
"CRITICAL: Faces in this photo are small. Each person's face must remain PIXEL-IDENTICAL to the original — same face shape, same skin, same features, same expression. Do NOT regenerate, retouch, relight, or alter any face. Copy faces exactly as-is from the original image."
小脸时人物反应只能用身体语言（身体后仰/转头/手指向变化），绝不能要求面部表情变化。

自检框架（输出每个tip前先过一遍）：

${info.selfCheck}

${info.rules}

⚠️ 人脸保真是最大扣分项！涉及人物的editPrompt必须包含：
"Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider or rounder."
- 最安全：人物完全不变，只改物品/环境

⚠️ 所有editPrompt都必须包含背景净化：
"Remove all distracting background pedestrians and bystanders."

2个tip必须选不同方向。结尾加"Do NOT add any text, watermarks, or borders."`;
}

// Load single .md prompt template from disk
const _promptTemplateCache: Record<string, string> = {};
function getPromptTemplate(category: TipCategory): string {
  if (_promptTemplateCache[category] && process.env.NODE_ENV === 'production') {
    return _promptTemplateCache[category];
  }
  const promptsDir = path.join(process.cwd(), 'src/lib/prompts');
  const content = fs.readFileSync(path.join(promptsDir, `${category}.md`), 'utf-8');
  _promptTemplateCache[category] = content;
  return content;
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
      category: { type: Type.STRING, enum: ['enhance', 'creative', 'wild'] },
      aspectRatio: { type: Type.STRING, description: 'Only for recomposition tips', nullable: true },
    },
    required: ['emoji', 'label', 'desc', 'editPrompt', 'category'],
  },
};

const JSON_FORMAT_SUFFIX = `\n\n请严格以JSON数组格式回复，只输出JSON，不要其他文字。格式：
[{"emoji":"1个emoji","label":"中文3-6字动词开头","desc":"中文10-25字短描述","editPrompt":"Detailed English editing prompt (MUST be in English)","category":"enhance|creative|wild"}, ...]`;

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

function getOrCreateGoogleSession(sessionId: string): Chat {
  const existing = sessions.get(sessionId);
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

  sessions.set(sessionId, { type: 'google', chat, lastUsed: Date.now() });
  return chat;
}

function getOrCreateOpenRouterSession(sessionId: string): OpenRouterSession {
  const existing = sessions.get(sessionId);
  if (existing && existing.type === 'openrouter') {
    existing.lastUsed = Date.now();
    return existing;
  }

  const session: OpenRouterSession = {
    type: 'openrouter',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    lastUsed: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ── Streaming Chat ──────────────────────────────────────────────

export type ChatStreamEvent =
  | { type: 'content'; text: string }
  | { type: 'image'; image: string }
  | { type: 'done' };

export async function* chatStreamWithModel(
  sessionId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  if (PROVIDER === 'openrouter') {
    yield* chatStreamOpenRouter(sessionId, message, imageBase64, wantImage, aspectRatio);
  } else {
    yield* chatStreamGoogle(sessionId, message, imageBase64, wantImage, aspectRatio);
  }
}

// --- Google Provider ---
async function* chatStreamGoogle(
  sessionId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  const chat = getOrCreateGoogleSession(sessionId);

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
  sessionId: string,
  message: string,
  imageBase64?: string,
  wantImage?: boolean,
  aspectRatio?: string,
): AsyncGenerator<ChatStreamEvent> {
  const session = getOrCreateOpenRouterSession(sessionId);

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

// ── Streaming Tips Generation (per-category) ────────────────────

export async function* streamTipsByCategory(
  imageBase64: string,
  category: TipCategory,
): AsyncGenerator<Tip> {
  if (PROVIDER === 'openrouter') {
    yield* streamTipsByCategoryOpenRouter(imageBase64, category);
  } else {
    yield* streamTipsByCategoryGoogle(imageBase64, category);
  }
}

// --- Google Provider ---
async function* streamTipsByCategoryGoogle(
  imageBase64: string,
  category: TipCategory,
): AsyncGenerator<Tip> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const template = getPromptTemplate(category);
  const systemPrompt = buildCategorySystemPrompt(category);

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
            text: `分析这张图片，参考以下模板，给出2条${category}编辑建议。

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
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = getPromptTemplate(category);
  const systemPrompt = buildCategorySystemPrompt(category);

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
              text: `分析这张图片，参考以下模板，给出2条${category}编辑建议。

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
