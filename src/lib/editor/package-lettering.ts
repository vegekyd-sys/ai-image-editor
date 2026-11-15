import type { DesignPayload } from '@/types';

type Rect = { left: number; top: number; width: number; height: number };
type Part = { id: string; label: string; rect: Rect };
type Position = { x: number; y: number };
type Scale = { w: number; h: number };

export type PackageLayout = { parts: Map<string, Part>; owners: Map<string, string> };

// Older Layerize snapshots have names and source rectangles but no owner IDs.
// Require a physical surface AND wording about print: poster copy can overlap a bottle.
const vessel = /易拉罐|罐体|罐身|罐體|铝罐|鋁罐|塑料瓶|瓶身|茶瓶|酒瓶|玻璃瓶|ボトル|缶|\b(?:bottles?|cans?|jars?)\b/i;
const carton = /包装盒|包裝盒|包装袋|包裝袋|纸盒|紙盒|パッケージ|\b(?:cartons?|boxes|box|pouches?|packages?|packaging)\b/i;
const surface = /罐身|罐体|罐體|瓶身|瓶盖|瓶蓋|罐上|瓶上|标签上|標籤上|盒身|盒上|袋身|袋上|包装上|包裝上|缶|ボトル|パッケージ|ラベル|\b(?:on|printed|label)\b/i;
const lettering = /文字|英文|字样|字樣|印字|标识|標識|ロゴ|テキスト|\b(?:text|lettering|wordmark|logo|label)\b/i;
const headline = /主标题|副标题|主標題|副標題|海报标题|海報標題|\bheadline\b/i;

function containsLabel(parent: Rect, child: Rect) {
  const w = Math.max(0, Math.min(parent.left + parent.width, child.left + child.width) - Math.max(parent.left, child.left));
  const h = Math.max(0, Math.min(parent.top + parent.height, child.top + child.height) - Math.max(parent.top, child.top));
  return w * h >= child.width * child.height * .9;
}

export function packageLayout(design?: DesignPayload): PackageLayout {
  const parts = new Map<string, Part>(), owners = new Map<string, string>();
  if (!design || design.animation || design.props?._canvasSizing !== 'fixed') return { parts, owners };
  const fields = new Map(design.editables?.map(f => [f.id, f]));
  // Read only the literal layout emitted by buildLayerizeDesign. These are source
  // coordinates, so saved user offsets never change who owns a printed label.
  const tags = /<(?:Img|div) data-editable="(layer_\d+(?:_artwork|_text_\d+)?)"[^>]*?style=\{\{([^{}<>]+)\}\}/g;
  for (const [, id, style] of design.code.matchAll(tags)) {
    const field = fields.get(id);
    const coords = /"left":([\d.]+),"top":([\d.]+),"width":([\d.]+),"height":([\d.]+)/.exec(style);
    if (!field || !coords) continue;
    const [left, top, width, height] = coords.slice(1).map(Number);
    if (width > 0 && height > 0) parts.set(id, { id, label: field.label || '', rect: { left, top, width, height } });
  }
  const explicit = design.props?._layerizeAttachments as Record<string, string> | undefined;
  const packages = [...parts.values()].filter(p => p.id !== 'layer_0' && (vessel.test(p.label) || carton.test(p.label)));
  for (const child of parts.values()) {
    const parentId = explicit?.[child.id];
    if (parentId && parts.has(parentId) && parentId !== child.id) {
      owners.set(child.id, parentId);
      continue;
    }
    if (!surface.test(child.label) || !lettering.test(child.label) || headline.test(child.label)) continue;
    const matches = packages.filter(p => p !== child && p.rect.width * p.rect.height > child.rect.width * child.rect.height &&
      containsLabel(p.rect, child.rect) && (!vessel.test(child.label) || vessel.test(p.label)) &&
      (!carton.test(child.label) || carton.test(p.label)));
    if (matches.length === 1) owners.set(child.id, matches[0].id);
  }
  return { parts, owners };
}

/** Translate peers by the same delta. On resize, scale around the selected
 * layer's current center, preserving every member's preexisting offset. */
export function packagePeerTransforms(layout: PackageLayout, props: Record<string, unknown>, id: string,
  position?: Position, scale?: Scale): Record<string, Position | Scale> {
  const root = layout.owners.get(id) ?? id;
  const deleted = (props._layerState as { deleted?: string[] } | undefined)?.deleted ?? [];
  const anchor = layout.parts.get(id);
  const changes: Record<string, Position | Scale> = {};
  if (!anchor || deleted.includes(root)) return changes;
  const pos = (key: string) => (props['_pos_' + key] as Position | undefined) ?? { x: 0, y: 0 };
  const size = (key: string) => (props['_scale_' + key] as Scale | undefined) ?? { w: 1, h: 1 };
  const origin = pos(id), base = size(id);
  const dx = (position?.x ?? origin.x) - origin.x, dy = (position?.y ?? origin.y) - origin.y;
  const sx = scale ? scale.w / base.w : 1, sy = scale ? scale.h / base.h : 1;
  for (const [peerId, part] of layout.parts) {
    if (peerId === id || (peerId !== root && layout.owners.get(peerId) !== root) || deleted.includes(peerId)) continue;
    const before = pos(peerId);
    const cx = part.rect.left + part.rect.width / 2 + before.x - anchor.rect.left - anchor.rect.width / 2 - origin.x;
    const cy = part.rect.top + part.rect.height / 2 + before.y - anchor.rect.top - anchor.rect.height / 2 - origin.y;
    changes['_pos_' + peerId] = { x: before.x + dx + cx * (sx - 1), y: before.y + dy + cy * (sy - 1) };
    if (scale) changes['_scale_' + peerId] = { w: size(peerId).w * sx, h: size(peerId).h * sy };
  }
  return changes;
}
