import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import type { Node, JSXElement, Expression } from '@babel/types';

/** Conservative static check for primary footage. Only rejects when every video
 * box can be measured and all are small. Dynamic/unknown layouts stay eligible
 * for preview QA; this never rewrites creative code or guesses source shape. */
export function validatePrimaryVideoFraming(code: string, width: number, height: number): string | null {
  try {
    const ast = parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
    const areas: Array<number | undefined> = [];
    function value(node: Node | null | undefined, path: NodePath, seen = new Set<Node>()): number | string | undefined {
      if (!node || seen.has(node)) return undefined;
      const next = new Set(seen).add(node);
      if (node.type === 'NumericLiteral' || node.type === 'StringLiteral') return node.value;
      if (node.type === 'Identifier') {
        const binding = path.scope.getBinding(node.name);
        if (binding?.constant && binding.path.isVariableDeclarator()) return value(binding.path.node.init, binding.path, next);
      }
      if (node.type === 'UnaryExpression') {
        const n = value(node.argument, path, next);
        if (typeof n === 'number') return node.operator === '-' ? -n : node.operator === '+' ? n : undefined;
      }
      if (node.type === 'BinaryExpression') {
        const a = value(node.left, path, next), b = value(node.right, path, next);
        if (typeof a === 'number' && typeof b === 'number') {
          return node.operator === '*' ? a * b : node.operator === '/' ? a / b
            : node.operator === '+' ? a + b : node.operator === '-' ? a - b : undefined;
        }
      }
      return undefined;
    }
    function size(node: Expression | undefined, parent: number | undefined, path: NodePath): number | undefined {
      const n = value(node, path);
      if (typeof n === 'number') return n;
      if (typeof n === 'string' && /^\d+(?:\.\d+)?(?:px|%)$/.test(n)) {
        return n.endsWith('%') ? parent === undefined ? undefined : parseFloat(n) / 100 * parent : parseFloat(n);
      }
      return undefined;
    }
    traverse(ast, {
      JSXElement(path) {
        const name = path.node.openingElement.name;
        if (name.type !== 'JSXIdentifier' || !['Video', 'OffthreadVideo', 'Html5Video', 'video'].includes(name.name)) return;
        const chain: NodePath<JSXElement>[] = [path];
        for (let p: NodePath | null = path.parentPath; p; p = p.parentPath) if (p.isJSXElement()) chain.unshift(p);
        let w: number | undefined = width, h: number | undefined = height;
        for (const element of chain) {
          const opening = element.node.openingElement;
          const attr = opening.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'style');
          const expression = attr?.type === 'JSXAttribute' && attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : undefined;
          if (expression && expression.type !== 'ObjectExpression') { w = h = undefined; continue; }
          if (expression?.type !== 'ObjectExpression') continue;
          if (expression.properties.some(p => p.type !== 'ObjectProperty' || p.computed)) { w = h = undefined; continue; }
          const fields = new Map(expression.properties.flatMap(p => p.type === 'ObjectProperty'
            ? [[p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : '', p.value as Expression] as const] : []));
          if (fields.has('width')) w = size(fields.get('width'), w, element);
          if (fields.has('height')) h = size(fields.get('height'), h, element);
          // Without explicit sizing, a normal DOM box has content-driven
          // height; only a full-inset box proves inherited canvas geometry.
          const tag = opening.name.type === 'JSXIdentifier' ? opening.name.name : '';
          if (/^[a-z]/.test(tag) && !fields.has('height') && value(fields.get('inset'), element) !== 0) h = undefined;
        }
        areas.push(w !== undefined && h !== undefined && w > 0 && h > 0 ? w * h / (width * height) : undefined);
      },
    });
    if (!areas.length || areas.some(area => area === undefined || area >= 0.5)) return null;
    return 'Composition rejected: every primary video box occupies less than half of the canvas although the selected footage already matches the canvas aspect. Do not put portrait footage in a short landscape strip. Enlarge the footage to fill or nearly fill the matching canvas, overlay captions/branding, and check actual picture occupancy with preview_frame. Use video_layout:"inset" only for an explicitly requested inset, split-screen or picture-in-picture treatment.';
  } catch { return null; }
}
