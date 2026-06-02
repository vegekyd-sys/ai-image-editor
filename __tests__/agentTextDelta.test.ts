import { describe, expect, it } from 'vitest';
import { createTextDeltaState, normalizeTextDelta } from '../src/lib/agent-text-delta';

describe('normalizeTextDelta', () => {
  it('prefers SDK delta fields over legacy text fields', () => {
    const state = createTextDeltaState();

    expect(normalizeTextDelta({ delta: 'hello', text: 'ignored cumulative text' }, state)).toBe('hello');
    expect(normalizeTextDelta({ textDelta: ' world' }, state)).toBe(' world');
  });

  it('dedupes cumulative legacy text chunks', () => {
    const state = createTextDeltaState();
    const chunks = [
      '好的，精简版导演板来了！\n\n## 导演板 — 入侵协议\n\n**基调**：3D 卡',
      '好的，精简版导演板来了！\n\n## 导演板 — 入侵协议\n\n**基调**：3D 卡通赛博朋克，',
      '蓝紫霓虹，三级加速节奏。',
      '唯一的声音。观众跟着 V 的视角走，Codex 的情绪变化是全片的节奏',
      '唯一的声音。观众跟着 V 的视角走，Codex 的情绪变化是全片的节奏鼓点。',
    ];

    const text = chunks.map((text) => normalizeTextDelta({ text }, state)).join('');

    expect(text).toBe(
      '好的，精简版导演板来了！\n\n## 导演板 — 入侵协议\n\n**基调**：3D 卡通赛博朋克，' +
      '蓝紫霓虹，三级加速节奏。' +
      '唯一的声音。观众跟着 V 的视角走，Codex 的情绪变化是全片的节奏鼓点。',
    );
  });

  it('drops repeated long chunks emitted twice', () => {
    const state = createTextDeltaState();
    const chunk = '确认后进入 **Gate 6：3 张分镜图**，说"继续"！';

    expect(normalizeTextDelta({ delta: chunk }, state)).toBe(chunk);
    expect(normalizeTextDelta({ delta: chunk }, state)).toBe('');
  });
});
