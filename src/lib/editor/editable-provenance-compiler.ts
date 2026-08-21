import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { Expression, JSXAttribute } from '@babel/types';
import type { EditableField } from '@/types';
import {
  compileEditableManifest,
  type EditableManifestInput,
  type EditableManifestResult,
} from './editable-manifest';
import {
  analyzeEditableProvenance,
  type EditableProvenanceNode,
  type ProvenanceOrigin,
} from './editable-provenance';

interface SourceInsertion {
  offset: number;
  end?: number;
  text: string;
}

interface InstrumentationSite {
  openingStart: number;
  insertionOffset: number;
  tag: string;
  line?: number;
  bindingKeys: Set<string>;
  sourcePathsByBinding: Map<string, Set<string>>;
  valueExpression?: string;
}

function applyInsertions(code: string, insertions: SourceInsertion[]): string {
  return [...insertions]
    .sort((a, b) => b.offset - a.offset)
    .reduce(
      (current, insertion) => (
        `${current.slice(0, insertion.offset)}${insertion.text}${current.slice(insertion.end ?? insertion.offset)}`
      ),
      code,
    );
}

function staticEditableId(attribute: JSXAttribute | undefined): string | null {
  if (!attribute?.value) return null;
  if (attribute.value.type === 'StringLiteral') return attribute.value.value;
  if (
    attribute.value.type === 'JSXExpressionContainer'
    && attribute.value.expression.type === 'StringLiteral'
  ) {
    return attribute.value.expression.value;
  }
  return null;
}

function expressionFromJsxAttribute(attribute: JSXAttribute | undefined): Expression | null {
  if (
    attribute?.value?.type === 'JSXExpressionContainer'
    && attribute.value.expression.type !== 'JSXEmptyExpression'
  ) {
    return attribute.value.expression as Expression;
  }
  return null;
}

function isDirectPropRead(expression: Expression | null, propKey: string): boolean {
  if (
    expression?.type !== 'MemberExpression'
    || expression.object.type !== 'Identifier'
    || expression.object.name !== 'props'
  ) {
    return false;
  }
  if (!expression.computed && expression.property.type === 'Identifier') {
    return expression.property.name === propKey;
  }
  return expression.computed
    && expression.property.type === 'StringLiteral'
    && expression.property.value === propKey;
}

/**
 * A static editable id on a reusable media leaf is unsafe when its `src` is a
 * helper parameter or another dynamic expression: every rendered instance can
 * be claimed by the same id. Remove only that marker and let provenance infer
 * the real per-source ids. Direct `src={props.<matching key>}` ownership and
 * explicit wrapper ownership remain untouched.
 */
function removeUnsafeStaticMediaMarkers(
  code: string,
  editables?: EditableField[],
): string {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    return code;
  }
  const propKeyById = new Map((editables ?? []).map(field => [field.id, field.propKey]));
  const removals: SourceInsertion[] = [];
  traverse(ast, {
    JSXOpeningElement(path) {
      const opening = path.node;
      if (
        opening.name.type !== 'JSXIdentifier'
        || !['Img', 'img', 'Video', 'video', 'OffthreadVideo'].includes(opening.name.name)
      ) {
        return;
      }
      const marker = opening.attributes.find((attribute): attribute is JSXAttribute => (
        attribute.type === 'JSXAttribute'
        && attribute.name.type === 'JSXIdentifier'
        && attribute.name.name === 'data-editable'
      ));
      const id = staticEditableId(marker);
      if (!marker || !id || marker.start == null || marker.end == null) return;
      const src = opening.attributes.find((attribute): attribute is JSXAttribute => (
        attribute.type === 'JSXAttribute'
        && attribute.name.type === 'JSXIdentifier'
        && attribute.name.name === 'src'
      ));
      const propKey = propKeyById.get(id) ?? id;
      if (isDirectPropRead(expressionFromJsxAttribute(src), propKey)) return;
      let offset = marker.start;
      while (offset > 0 && /[ \t]/.test(code[offset - 1])) offset -= 1;
      removals.push({ offset, end: marker.end, text: '' });
    },
  });
  return removals.length > 0 ? applyInsertions(code, removals) : code;
}

function sourcePathParts(sourcePath: string): Array<string | number> | null {
  if (!sourcePath.startsWith('props')) return null;
  const parts: Array<string | number> = [];
  const suffix = sourcePath.slice('props'.length);
  const tokenPattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g;
  let consumed = 0;
  for (const match of suffix.matchAll(tokenPattern)) {
    if (match.index !== consumed) return null;
    parts.push(match[1] ?? Number(match[2]));
    consumed = (match.index ?? 0) + match[0].length;
  }
  return consumed === suffix.length ? parts : null;
}

function readSourceValue(
  props: Record<string, unknown>,
  origin: ProvenanceOrigin,
): unknown {
  const parts = sourcePathParts(origin.sourcePath);
  if (!parts) return undefined;
  let value: unknown = props;
  for (const part of parts) {
    if (value == null || (typeof value !== 'object' && !Array.isArray(value))) {
      return undefined;
    }
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

function materializeBindingAliases(
  nodes: EditableProvenanceNode[],
  props: Record<string, unknown> | undefined,
) {
  if (!props) return;
  nodes.forEach(node => {
    node.origins.forEach(origin => {
      if (props[origin.bindingKey] !== undefined) return;
      const literalValue = node.literalValues?.[origin.bindingKey];
      const value = literalValue ?? readSourceValue(props, origin);
      if (value !== undefined) props[origin.bindingKey] = value;
    });
  });
}

function instrumentationSites(nodes: EditableProvenanceNode[]): InstrumentationSite[] {
  const sites = new Map<number, InstrumentationSite>();
  nodes.forEach(node => {
    if (
      node.hasExplicitMarker
      || node.openingStart == null
      || node.insertionOffset == null
    ) return;
    const existing = sites.get(node.openingStart);
    if (existing) {
      node.bindingKeys.forEach(key => existing.bindingKeys.add(key));
      node.origins.forEach(origin => {
        const paths = existing.sourcePathsByBinding.get(origin.bindingKey) ?? new Set<string>();
        paths.add(origin.sourcePath);
        existing.sourcePathsByBinding.set(origin.bindingKey, paths);
      });
      existing.valueExpression ??= node.valueExpression;
      return;
    }
    sites.set(node.openingStart, {
      openingStart: node.openingStart,
      insertionOffset: node.insertionOffset,
      tag: node.tag,
      ...(node.line ? { line: node.line } : {}),
      bindingKeys: new Set(node.bindingKeys),
      sourcePathsByBinding: new Map(node.origins.map(origin => [
        origin.bindingKey,
        new Set([origin.sourcePath]),
      ])),
      ...(node.valueExpression ? { valueExpression: node.valueExpression } : {}),
    });
  });
  return [...sites.values()].sort((a, b) => a.openingStart - b.openingStart);
}

function insertionForSite(site: InstrumentationSite): SourceInsertion | null {
  const bindingKeys = [...site.bindingKeys].sort();
  if (bindingKeys.length === 0) return null;
  if (bindingKeys.length === 1) {
    return {
      offset: site.insertionOffset,
      text: ` data-editable=${JSON.stringify(bindingKeys[0])}${site.valueExpression
        ? ` data-editable-provenance={${site.valueExpression}}`
        : ''}`,
    };
  }
  if (!site.valueExpression) return null;
  const candidates = bindingKeys.map(id => ({
    id,
    paths: [...(site.sourcePathsByBinding.get(id) ?? [])]
      .filter(path => path.startsWith('props')),
  }));
  return {
    offset: site.insertionOffset,
    text: ` data-editable={React.__makaronEditableId(${site.valueExpression}, ${JSON.stringify(candidates)})} data-editable-provenance={${site.valueExpression}}`,
  };
}

function unsupportedResolved(
  unsupported: string,
  nodes: EditableProvenanceNode[],
): boolean {
  const match = unsupported.match(/^<([^>]+)>(?: at line (\d+))?/);
  if (!match) return false;
  const [, tag, lineText] = match;
  const line = lineText ? Number(lineText) : null;
  return nodes.some(node => (
    (node.tag === tag && (line == null || node.line === line))
    || (
      node.type === 'text'
      && line != null
      && node.line != null
      && node.endLine != null
      && line >= node.line
      && line <= node.endLine
    )
  ));
}

function mergeFields(
  legacyFields: EditableField[],
  provenanceFields: EditableField[],
): EditableField[] {
  const fields = [...legacyFields];
  const propKeys = new Set(fields.map(field => field.propKey));
  provenanceFields.forEach(field => {
    if (propKeys.has(field.propKey)) return;
    fields.push(field);
    propKeys.add(field.propKey);
  });
  return fields;
}

/**
 * Experimental V2 compiler: retain the proven legacy compiler, then fill its
 * unsupported natural-React paths with provenance analysis. Every inserted
 * marker uses the existing data-editable runtime contract, so text/media
 * editing, Moveable drag/scale, persistence, preview, and export continue to
 * share the same `_pos_*` and `_scale_*` overrides.
 */
export function compileEditableManifestWithProvenance(
  input: EditableManifestInput,
): EditableManifestResult {
  const legacy = compileEditableManifest({
    ...input,
    code: removeUnsafeStaticMediaMarkers(input.code, input.editables),
  });
  const provenance = analyzeEditableProvenance({
    code: legacy.code,
    props: input.props,
    editables: legacy.editables,
  });
  materializeBindingAliases(provenance.nodes, input.props);

  const sites = instrumentationSites(provenance.nodes);
  const insertions = sites
    .map(insertionForSite)
    .filter((insertion): insertion is SourceInsertion => insertion !== null);
  const uninstrumented = sites.filter(site => insertionForSite(site) === null);
  const instrumentedStarts = new Set(
    sites
      .filter(site => insertionForSite(site) !== null)
      .map(site => site.openingStart),
  );
  const resolvedBindingKeys = new Set(provenance.nodes.flatMap(node => (
    node.hasExplicitMarker
    || (node.openingStart != null && instrumentedStarts.has(node.openingStart))
      ? node.bindingKeys
      : []
  )));
  const fields = mergeFields(
    legacy.editables,
    provenance.fields.filter(field => resolvedBindingKeys.has(field.propKey)),
  );
  const unresolved = legacy.coverage.unsupported.filter(item => (
    !unsupportedResolved(item, provenance.nodes)
  ));
  const diagnostics = legacy.diagnostics.filter(diagnostic => (
    !diagnostic.startsWith('Editable coverage incomplete:')
    && !(
      uninstrumented.length === 0
      && diagnostic.includes('renders multiple editable props')
    )
    && !(
      uninstrumented.length === 0
      && diagnostic.startsWith('Could not infer editable ids for')
    )
  ));
  diagnostics.push(...provenance.diagnostics);
  uninstrumented.forEach(site => {
    diagnostics.push(
      `Provenance found multiple bindings for <${site.tag}>${site.line ? ` at line ${site.line}` : ''}, but its complete rendered value could not be instrumented.`,
    );
  });
  if (unresolved.length > 0) {
    diagnostics.push(`Editable coverage incomplete: ${unresolved.join(' ')}`);
  }

  return {
    code: applyInsertions(legacy.code, insertions),
    editables: fields,
    diagnostics: [...new Set(diagnostics)],
    coverage: {
      visibleSinks: Math.max(legacy.coverage.visibleSinks, provenance.nodes.length),
      editable: fields.length,
      ignored: legacy.coverage.ignored,
      unsupported: unresolved,
    },
  };
}
