import { GoogleGenAI, Chat, Type } from '@google/genai';
import { Tip } from '@/types';
import fs from 'fs';
import path from 'path';

let _ai: GoogleGenAI | null = null;
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
  return _ai;
}

// Switch model here. Primary: gemini-3-pro-image-preview. Fallback: gemini-2.5-flash-image
const MODEL = 'gemini-2.5-flash-image';

const SYSTEM_PROMPT = `你是世界上最好的照片编辑AI。你能深入理解图片的每个细节——主体、情绪、光线、构图、环境、色彩、纹理、瑕疵和故事。

收到图片时，用中文简短点评（2-3句话，展示你真的看懂了这张图）。

当用户要求编辑图片时，你直接生成编辑后的图片。不要只是描述要做什么——直接生成图片！生成图片后用中文简短描述你做了什么（1-2句话）。

人脸保持规则：
- 每个人的身份必须保持：相同的脸型、眼睛、鼻子、嘴巴、面部结构
- 皮肤可以优化，但骨骼结构不能变
- 发型发色保持不变（除非编辑要求改变）
- 表情姿势保持不变（除非编辑要求改变）`;

// --- Tips Generation (separate structured call) ---

// Short system instruction for structured output (keeps under Gemini's limit)
const TIPS_SYSTEM_PROMPT = `你是图片编辑建议专家。分析图片后生成6条编辑建议（2 enhance + 2 creative + 2 wild）。

label必须用中文3-6字，动词开头。editPrompt用英文，极其具体。

三类tip的核心区别：
- enhance = 让照片整体变好看（光影/色彩/通透感），变化必须肉眼明显
- creative = 往画面里加入一个与画面内容有因果关系的有趣新元素
- wild = 让画面中已有的物品发生疯狂变化（不是加新东西！）

自检框架（输出每个tip前先过一遍）：

enhance自检：
- 放在原图旁边，任何人都能一眼看出提升吗？（"看不出变化"=3分）
- 风格与照片情绪匹配吗？（搞笑照片配阴沉暗调=4分）
- 有通透感+景深分离+色调层次吗？

creative自检（三问全过才输出）：
- Q1 为什么是这个元素？能不能一句话说清"因为画面里有X所以加Y"？说不清=换一个
- Q2 情绪对吗？让人笑/惊喜=好，让人害怕/困惑=换
- Q3 这个创意能用在其他照片上吗？能=太通用=换一个

wild自检（三问全过才输出）：
- Q1 变化的主角是画面中已有的什么东西？指不出来=不是wild
- Q2 变化够大吗？一眼就能看到变化=好
- Q3 变化是基于物品本身特点还是随便套的？表面视觉类比（层状=蛋糕）=换一个

6个tip必须各不相同。涉及人物的editPrompt必须加面部保真指令。
结尾加"Do NOT add any text, watermarks, or borders."`;

// Load .md prompt templates from disk
// In production: cached. In dev: reloads on every call for easy iteration.
let _promptTemplates: string | null = null;
function getPromptTemplates(): string {
  if (_promptTemplates && process.env.NODE_ENV === 'production') return _promptTemplates;
  const promptsDir = path.join(process.cwd(), 'src/lib/prompts');
  const files = ['enhance.md', 'creative.md', 'wild.md'];
  _promptTemplates = files
    .map((f) => fs.readFileSync(path.join(promptsDir, f), 'utf-8'))
    .join('\n\n');
  return _promptTemplates;
}

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

// --- Session Management ---

interface Session {
  chat: Chat;
  lastUsed: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

function getOrCreateSession(sessionId: string): Chat {
  const existing = sessions.get(sessionId);
  if (existing) {
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

  sessions.set(sessionId, { chat, lastUsed: Date.now() });
  return chat;
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// --- Streaming Chat ---

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
  const chat = getOrCreateSession(sessionId);

  // Build message parts
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: base64Data } });
  }

  parts.push({ text: message });

  // Per-request config
  const config: Record<string, unknown> = {};
  if (wantImage) {
    config.responseModalities = ['TEXT', 'IMAGE'];
    if (aspectRatio) {
      config.imageConfig = { aspectRatio };
    }
  } else {
    config.responseModalities = ['TEXT'];
  }

  // --- Stream text + image from main chat ---
  const stream = await chat.sendMessageStream({
    message: parts,
    config,
  });

  let resultImageBase64: string | undefined;

  for await (const chunk of stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts;
    if (!chunkParts) continue;

    for (const part of chunkParts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || 'image/png';
        resultImageBase64 = `data:${mime};base64,${part.inlineData.data}`;
        yield { type: 'image', image: resultImageBase64 };
      } else if (part.text) {
        yield { type: 'content', text: part.text };
      }
    }
  }

  yield { type: 'done' };
}

// --- Streaming Tips Generation (separate call) ---

export async function* streamTips(imageBase64: string): AsyncGenerator<Tip> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

  // Load detailed creative direction templates from .md files
  const templates = getPromptTemplates();

  // gemini-3-pro supports structured output; flash-image doesn't — fall back to plain JSON in prompt
  const supportsStructuredOutput = MODEL.includes('gemini-3');
  const config: Record<string, unknown> = {
    systemInstruction: TIPS_SYSTEM_PROMPT,
  };
  if (supportsStructuredOutput) {
    config.responseMimeType = 'application/json';
    config.responseSchema = TIPS_SCHEMA;
  }

  const promptSuffix = supportsStructuredOutput
    ? ''
    : `\n\n请严格以JSON数组格式回复，只输出JSON，不要其他文字。格式：
[{"emoji":"1个emoji","label":"中文3-6字动词开头","desc":"中文10-25字短描述","editPrompt":"Detailed English editing prompt (MUST be in English)","category":"enhance|creative|wild"}, ...]`;

  const stream = await getAI().models.generateContentStream({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: `分析这张图片，参考以下素材库，给出6条编辑建议（2 enhance + 2 creative + 2 wild）。

${templates}${promptSuffix}`,
          },
        ],
      },
    ],
    config,
  });

  // Incrementally parse JSON array: detect each completed {...} object
  let fullText = '';
  let tipsEmitted = 0;

  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) continue;
    fullText += text;

    // Try to extract complete JSON objects from the accumulated text
    // The output is a JSON array like [{...}, {...}, ...]
    // We find each complete object by matching balanced braces
    let searchFrom = 0;
    let objectsFound = 0;
    for (let i = 0; i < fullText.length; i++) {
      if (fullText[i] === '{') {
        // Find the matching closing brace
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
          i = j - 1; // skip past this object
        }
        searchFrom = j;
      }
    }
  }
}
