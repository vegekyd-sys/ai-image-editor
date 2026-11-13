import type { EditableField } from '@/types';

/** Keep provider descriptions intact; only shorten their visible names. */
export function editableDisplayLabel(field: Pick<EditableField, 'id' | 'label'>, background = 'Layer 0'): string {
  if (field.id === 'layer_0' && /^layer\s*0$/i.test(field.label.trim())) return background;
  let name = field.label.trim().split(/[，,。；;：:\n]/, 1)[0]
    .replace(/^(?:前景|后景|上方|下方|左侧|右侧|中间|中央)/u, '')
    .replace(/^(?:左手|右手|双手|手中)(?:握持|拿|持|捧)(?:着|的)?/u, '')
    .replace(/(?:角色人物|人物角色|角色|图层)$/u, '').trim();
  if (/[\u3400-\u9fff]/u.test(name)) {
    // Preserve identifying names such as Codex/OpenClaw instead of clipping them off.
    const named = name.match(/[A-Za-z][A-Za-z0-9.-]{1,}(?:[\u3400-\u9fff]{0,4})/u);
    if (Array.from(name).length > 10 && named) name = named[0];
    if (Array.from(name).length > 10) name = name.split(/[与和及]/u, 1)[0];
    const chars = Array.from(name);
    return chars.length > 10 ? `${chars.slice(0, 9).join('')}…` : name || field.label;
  }
  const words = name.split(/\s+/);
  const chosen = words.slice(0, 4);
  while (chosen.length > 1 && chosen.join(' ').length > 24) chosen.pop();
  name = chosen.join(' ');
  return name.length > 24 ? `${name.slice(0, 23).trimEnd()}…` : `${name}${words.length > chosen.length ? '…' : ''}`;
}

export function editableLabelPosition(rect: { left: number; top: number }, width: number, height: number) {
  const left = Math.max(4, Math.min(rect.left, Math.max(4, width - 100)));
  return { left, top: Math.max(4, Math.min(rect.top - 24, Math.max(4, height - 24))), maxWidth: Math.max(0, width - left - 4) };
}
