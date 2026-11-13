import { expect, it } from 'vitest';
import { editableDisplayLabel, editableLabelPosition } from '@/lib/editor/editable-label';
it('keeps identifying names while removing long image descriptions', () => {
  const label = (text: string) => editableDisplayLabel({ id: 'image', label: text });
  expect(label('右手握持的蓝色发光透明胶囊Codex装置，装置金属铭牌印有文字')).toBe('Codex装置');
  expect(label('银发女孩角色人物，身着浅蓝色无袖服饰')).toBe('银发女孩');
  expect(label('左手握持的做旧金属罐OpenClaw，罐身金属铭牌')).toBe('OpenClaw');
  expect(label('前景白发小女孩角色，包含白色双马尾长发')).toBe('白发小女孩');
  expect(label('Blue character holding an illuminated futuristic device')).toBe('Blue character holding…');
  expect(label('HELLO')).toBe('HELLO');
  expect(editableDisplayLabel({ id: 'layer_0', label: 'Layer 0' }, '背景')).toBe('背景');
});
it('keeps labels inside the visible canvas at the top and right edge', () => {
  expect(editableLabelPosition({left:-20,top:0},390,700)).toEqual({left:4,top:4,maxWidth:382});
  const p = editableLabelPosition({left:380,top:10},390,700);
  expect(p.top).toBeGreaterThanOrEqual(0); expect(p.left+p.maxWidth).toBeLessThanOrEqual(386);
});
