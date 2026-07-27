import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import type {
  Expression,
  JSXAttribute,
  JSXElement,
  JSXExpressionContainer,
  JSXOpeningElement,
  MemberExpression,
  Node,
  ObjectPattern,
} from '@babel/types';
import type { EditableField, EditableType } from '@/types';

export interface EditableManifestInput {
  code: string;
  props?: Record<string, unknown>;
  editables?: EditableField[];
}

export interface EditableManifestResult {
  code: string;
  editables: EditableField[];
  diagnostics: string[];
  coverage: EditableCoverage;
}

export interface EditableCoverage {
  visibleSinks: number;
  editable: number;
  ignored: number;
  unsupported: string[];
}

interface Candidate {
  opening: JSXOpeningElement;
  type: EditableType;
  staticIds: string[];
  propKeyById: Map<string, string>;
  sourceById?: Map<string, EditableField['source']>;
  instrumentId?: string;
}

interface SourceInsertion {
  offset: number;
  end?: number;
  text: string;
}

interface ComponentEditableHost {
  componentName: string;
  idParam: string;
  valueParam: string;
  type: EditableType;
}

interface NaturalComponentHost {
  componentName: string;
  objectPattern: ObjectPattern;
  opening: JSXOpeningElement;
  mediaOpening?: JSXOpeningElement;
  valueParam: string;
  markerParam: string;
  type: EditableType;
  staleMediaMarker?: JSXAttribute;
}

interface NaturalComponentCall {
  path: NodePath<JSXOpeningElement>;
  opening: JSXOpeningElement;
  parentComponentName: string | null;
  parentObjectPattern: ObjectPattern | null;
}

interface NaturalPropagationEdge {
  opening: JSXOpeningElement;
  childMarkerParam: string;
  parentMarkerParam: string;
  parentObjectPattern: ObjectPattern;
}

interface NaturalResolvedUsage {
  opening: JSXOpeningElement;
  markerParam: string;
  markerExpression?: string;
  propKey: string;
  source?: EditableField['source'];
  literalValue?: string;
  edges: NaturalPropagationEdge[];
}

const STRUCTURAL_TEXT_HOSTS = new Set([
  'AbsoluteFill',
  'Sequence',
  'Fragment',
  'React.Fragment',
]);

function jsxName(opening: JSXOpeningElement): string {
  const name = opening.name;
  if (name.type === 'JSXIdentifier') return name.name;
  if (
    name.type === 'JSXMemberExpression'
    && name.object.type === 'JSXIdentifier'
    && name.property.type === 'JSXIdentifier'
  ) {
    return `${name.object.name}.${name.property.name}`;
  }
  return '';
}

function humanizeId(id: string): string {
  const spaced = id
    .replace(/([a-z0-9])([A-Z])/g, (_, before: string, upper: string) =>
      `${before} ${upper.toLowerCase()}`
    )
    .replace(/[_-]+/g, ' ')
    .replace(/([A-Za-z])(\d+)$/g, '$1 $2')
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : id;
}

function staticStringAttributeValue(attribute: JSXAttribute | null): string | null {
  if (!attribute?.value) return null;
  if (attribute.value.type === 'StringLiteral') return attribute.value.value;
  const expression = expressionFromAttribute(attribute);
  if (expression?.type === 'StringLiteral') return expression.value;
  if (
    expression?.type === 'TemplateLiteral'
    && expression.expressions.length === 0
  ) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function staticTextExpressionValue(
  path: NodePath,
  expression: Node | null | undefined,
): string | null {
  if (!expression) return null;
  if (expression.type === 'StringLiteral') return expression.value;
  if (
    expression.type === 'TemplateLiteral'
    && expression.expressions.length === 0
  ) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  if (expression.type !== 'Identifier') return null;
  const binding = path.scope.getBinding(expression.name);
  if (
    !binding
    || !binding.constant
    || !binding.path.isVariableDeclarator()
  ) {
    return null;
  }
  const initializer = binding.path.node.init;
  if (initializer?.type === 'StringLiteral') return initializer.value;
  if (
    initializer?.type === 'TemplateLiteral'
    && initializer.expressions.length === 0
  ) {
    return initializer.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function directStaticTextValue(path: NodePath<JSXElement>): string | null {
  const parts: string[] = [];
  for (const child of path.node.children) {
    if (child.type === 'JSXText') {
      const value = child.value.replace(/\s+/g, ' ').trim();
      if (value) parts.push(value);
      continue;
    }
    if (child.type === 'JSXExpressionContainer') {
      const value = staticTextExpressionValue(path, child.expression);
      if (value?.trim()) {
        parts.push(value.trim());
        continue;
      }
      if (child.expression.type === 'JSXEmptyExpression') continue;
    }
    return null;
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function conditionalLiteralLeaves(
  node: Node | null | undefined,
): Array<{ node: Node; value: string }> | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return [{ node, value: node.value }];
  if (
    node.type === 'TemplateLiteral'
    && node.expressions.length === 0
  ) {
    return [{
      node,
      value: node.quasis[0]?.value.cooked ?? '',
    }];
  }
  if (node.type !== 'ConditionalExpression') return null;
  const consequent = conditionalLiteralLeaves(node.consequent);
  const alternate = conditionalLiteralLeaves(node.alternate);
  return consequent && alternate ? [...consequent, ...alternate] : null;
}

function staticEditableIdsFromExpression(node: Node | null | undefined): string[] {
  if (!node) return [];
  if (node.type === 'StringLiteral') return [node.value];
  if (
    node.type === 'TemplateLiteral'
    && node.expressions.length === 0
  ) {
    const value = node.quasis[0]?.value.cooked;
    return value ? [value] : [];
  }
  if (node.type === 'ConditionalExpression') {
    return [
      ...staticEditableIdsFromExpression(node.consequent),
      ...staticEditableIdsFromExpression(node.alternate),
    ];
  }
  return [];
}

function hasDirectTextLikeChild(element: JSXElement): boolean {
  return element.children.some(child => {
    if (child.type === 'JSXText') return Boolean(child.value.trim());
    if (child.type !== 'JSXExpressionContainer') return false;
    return [
      'Identifier',
      'MemberExpression',
      'StringLiteral',
      'TemplateLiteral',
      'NumericLiteral',
      'BinaryExpression',
      'ConditionalExpression',
    ].includes(child.expression.type);
  });
}

function isChildrenPassThrough(path: NodePath<JSXElement>): boolean {
  const meaningful = path.node.children.filter(child =>
    child.type !== 'JSXText' || Boolean(child.value.trim())
  );
  if (
    meaningful.length !== 1
    || meaningful[0].type !== 'JSXExpressionContainer'
    || meaningful[0].expression.type !== 'Identifier'
    || meaningful[0].expression.name !== 'children'
  ) {
    return false;
  }
  return path.scope.getBinding('children')?.kind === 'param';
}

function generatedTextStem(name: string): string {
  if (/^h[1-6]$/.test(name)) return name === 'h1' ? 'Title' : 'Heading';
  if (name === 'p') return 'Paragraph';
  if (name === 'label') return 'Label';
  if (name === 'small') return 'Caption';
  if (name === 'blockquote') return 'Quote';
  return 'Text';
}

function lowerCamel(value: string): string {
  return value.length > 0
    ? `${value[0].toLowerCase()}${value.slice(1)}`
    : value;
}

function semanticParamName(value: string): string {
  if (value === 'sub') return 'Subtitle';
  if (value === 'desc') return 'Description';
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function identifierFragment(value: string): string {
  const words = value
    .normalize('NFKD')
    .replace(/[^\w$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return lowerCamel(
    words
      .map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
      .join(''),
  );
}

function staticPropKey(node: Node | null | undefined): string | null {
  if (!node || node.type !== 'MemberExpression') return null;
  if (node.object.type !== 'Identifier' || node.object.name !== 'props') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
  if (
    node.computed
    && node.property.type === 'TemplateLiteral'
    && node.property.expressions.length === 0
  ) {
    return node.property.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function dynamicPropExpression(
  node: Node | null | undefined,
  code: string,
): string | null {
  if (!node || node.type !== 'MemberExpression') return null;
  if (node.object.type !== 'Identifier' || node.object.name !== 'props' || !node.computed) {
    return null;
  }
  const property = node.property;
  if (property.start == null || property.end == null) return null;
  return code.slice(property.start, property.end).replace(/\s+/g, '');
}

function expressionFromAttribute(attribute: JSXAttribute | null): Expression | null {
  if (!attribute?.value || attribute.value.type !== 'JSXExpressionContainer') return null;
  return attribute.value.expression.type === 'JSXEmptyExpression'
    ? null
    : attribute.value.expression;
}

function namedAttribute(
  opening: JSXOpeningElement,
  name: string,
): JSXAttribute | null {
  return opening.attributes.find((attribute): attribute is JSXAttribute =>
    attribute.type === 'JSXAttribute'
    && attribute.name.type === 'JSXIdentifier'
    && attribute.name.name === name
  ) ?? null;
}

function dataEditableAttribute(opening: JSXOpeningElement): JSXAttribute | null {
  return namedAttribute(opening, 'data-editable');
}

function staticEditableId(attribute: JSXAttribute | null): string | null {
  if (!attribute?.value) return null;
  if (attribute.value.type === 'StringLiteral') return attribute.value.value;
  const expression = expressionFromAttribute(attribute);
  return staticPropKey(expression)
    ?? (expression?.type === 'StringLiteral' ? expression.value : null);
}

function attributeExpressionSource(
  attribute: JSXAttribute | null,
  code: string,
): string | null {
  const expression = attribute ? expressionFromAttribute(attribute) : null;
  if (!expression || expression.start == null || expression.end == null) return null;
  return code.slice(expression.start, expression.end).replace(/\s+/g, '');
}

function directTextPropReads(element: JSXElement): MemberExpression[] {
  return element.children.flatMap(child => {
    if (child.type !== 'JSXExpressionContainer') return [];
    const expression = (child as JSXExpressionContainer).expression;
    return expression.type === 'MemberExpression' ? [expression] : [];
  });
}

function descendantTextPropKeys(path: NodePath<JSXElement>): string[] {
  const keys = new Set(
    directTextPropReads(path.node)
      .map(read => staticPropKey(read))
      .filter((key): key is string => Boolean(key)),
  );
  path.traverse({
    JSXElement(innerPath) {
      for (const read of directTextPropReads(innerPath.node)) {
        const key = staticPropKey(read);
        if (key) keys.add(key);
      }
    },
  });
  return [...keys];
}

function mediaPropRead(opening: JSXOpeningElement): MemberExpression | null {
  const source = opening.attributes.find((attribute): attribute is JSXAttribute =>
    attribute.type === 'JSXAttribute'
    && attribute.name.type === 'JSXIdentifier'
    && attribute.name.name === 'src'
  );
  const expression = source ? expressionFromAttribute(source) : null;
  return expression?.type === 'MemberExpression' ? expression : null;
}

function mediaTypeFromName(name: string): EditableType | null {
  if (name === 'Video' || name === 'OffthreadVideo' || name === 'video') return 'video';
  if (name === 'Img' || name === 'img') return 'image';
  return null;
}

function mediaCount(path: NodePath<JSXElement>): number {
  let count = mediaTypeFromName(jsxName(path.node.openingElement)) ? 1 : 0;
  path.traverse({
    JSXOpeningElement(innerPath) {
      if (mediaTypeFromName(jsxName(innerPath.node))) count += 1;
    },
  });
  return count;
}

/**
 * Remotion media components do not consistently forward arbitrary data
 * attributes to their final DOM node. Own the nearest ordinary React box that
 * contains only this media leaf so selection, transforms, and trim can share
 * one measurable scene node without extra authoring conventions.
 */
function naturalMediaOwnerOpening(path: NodePath<JSXElement>): JSXOpeningElement {
  const functionPath = path.findParent(parent =>
    parent.isFunctionDeclaration()
    || parent.isFunctionExpression()
    || parent.isArrowFunctionExpression()
  );
  let current: NodePath<Node> | null = path.parentPath;
  while (current && current !== functionPath) {
    if (current.isJSXElement()) {
      const name = jsxName(current.node.openingElement);
      const isIntrinsicBox = /^[a-z]/.test(name) && !mediaTypeFromName(name);
      if (isIntrinsicBox && mediaCount(current) === 1) {
        return current.node.openingElement;
      }
    }
    current = current.parentPath;
  }
  return path.node.openingElement;
}

function numericAttribute(
  opening: JSXOpeningElement,
  name: string,
): number | undefined {
  const expression = expressionFromAttribute(namedAttribute(opening, name));
  if (expression?.type === 'NumericLiteral') return expression.value;
  if (
    expression?.type === 'UnaryExpression'
    && expression.operator === '-'
    && expression.argument.type === 'NumericLiteral'
  ) {
    return -expression.argument.value;
  }
  return undefined;
}

function descendantMediaType(path: NodePath<JSXElement>): EditableType | null {
  let result: EditableType | null = mediaTypeFromName(jsxName(path.node.openingElement));
  if (result) return result;
  path.traverse({
    JSXOpeningElement(innerPath) {
      if (result) {
        innerPath.stop();
        return;
      }
      result = mediaTypeFromName(jsxName(innerPath.node));
    },
  });
  return result;
}

function descendantMediaPropKey(path: NodePath<JSXElement>): string | null {
  const ownRead = mediaPropRead(path.node.openingElement);
  const ownKey = staticPropKey(ownRead);
  if (ownKey) return ownKey;

  let result: string | null = null;
  path.traverse({
    JSXOpeningElement(innerPath) {
      if (result || !mediaTypeFromName(jsxName(innerPath.node))) return;
      result = staticPropKey(mediaPropRead(innerPath.node));
    },
  });
  return result;
}

function componentFunctionName(path: NodePath<JSXElement>): string | null {
  const functionPath = path.findParent(parent =>
    parent.isFunctionDeclaration()
    || parent.isFunctionExpression()
    || parent.isArrowFunctionExpression()
  );
  if (!functionPath) return null;
  if (functionPath.isFunctionDeclaration() && functionPath.node.id) {
    return functionPath.node.id.name;
  }
  const variable = functionPath.parentPath;
  if (
    variable?.isVariableDeclarator()
    && variable.node.id.type === 'Identifier'
  ) {
    return variable.node.id.name;
  }
  return null;
}

function componentObjectPattern(path: NodePath<JSXElement>): ObjectPattern | null {
  const functionPath = path.findParent(parent =>
    parent.isFunctionDeclaration()
    || parent.isFunctionExpression()
    || parent.isArrowFunctionExpression()
  );
  if (
    !functionPath
    || (
      !functionPath.isFunctionDeclaration()
      && !functionPath.isFunctionExpression()
      && !functionPath.isArrowFunctionExpression()
    )
  ) {
    return null;
  }
  const firstParam = functionPath?.node.params[0];
  return firstParam?.type === 'ObjectPattern' ? firstParam : null;
}

function objectPatternParamNames(pattern: ObjectPattern): Set<string> {
  const names = new Set<string>();
  for (const property of pattern.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const value = property.value;
    if (value.type === 'Identifier') {
      names.add(value.name);
    } else if (
      value.type === 'AssignmentPattern'
      && value.left.type === 'Identifier'
    ) {
      names.add(value.left.name);
    }
  }
  return names;
}

function directTextParamReads(element: JSXElement): string[] {
  return element.children.flatMap(child => {
    if (
      child.type !== 'JSXExpressionContainer'
      || child.expression.type !== 'Identifier'
    ) {
      return [];
    }
    return [child.expression.name];
  });
}

function naturalComponentHost(
  path: NodePath<JSXElement>,
): NaturalComponentHost | null {
  const opening = path.node.openingElement;
  if (namedAttribute(opening, 'data-editable-ignore')) return null;
  const editableAttribute = dataEditableAttribute(opening);
  const editableExpression = editableAttribute
    ? expressionFromAttribute(editableAttribute)
    : null;
  const compilerMarker = (
    editableAttribute
    && editableExpression?.type === 'Identifier'
    && editableExpression.name.startsWith('__makaronEditable_')
  )
    ? editableExpression
    : undefined;
  if (editableAttribute && !compilerMarker) return null;
  const componentName = componentFunctionName(path);
  const objectPattern = componentObjectPattern(path);
  if (!componentName || componentName === 'Composition' || !objectPattern) {
    return null;
  }
  const params = objectPatternParamNames(objectPattern);
  const ownMediaType = mediaTypeFromName(jsxName(opening));
  const mediaOwnerOpening = ownMediaType
    ? naturalMediaOwnerOpening(path)
    : opening;
  const staleMediaMarker = compilerMarker
    && ownMediaType
    && mediaOwnerOpening !== opening
    ? editableAttribute ?? undefined
    : undefined;
  let valueParam: string | null = null;
  if (ownMediaType) {
    const sourceExpression = expressionFromAttribute(namedAttribute(opening, 'src'));
    if (sourceExpression?.type === 'Identifier' && params.has(sourceExpression.name)) {
      valueParam = sourceExpression.name;
    }
  } else {
    const directParams = [...new Set(
      directTextParamReads(path.node).filter(param => params.has(param)),
    )];
    if (directParams.length === 1 && !STRUCTURAL_TEXT_HOSTS.has(jsxName(opening))) {
      valueParam = directParams[0];
    }
  }
  if (!valueParam) return null;
  return {
    componentName,
    objectPattern,
    opening: mediaOwnerOpening,
    mediaOpening: ownMediaType ? opening : undefined,
    valueParam,
    markerParam: compilerMarker?.name
      ?? `__makaronEditable_${valueParam.replace(/[^\w$]/g, '_')}`,
    type: ownMediaType ?? 'text',
    staleMediaMarker,
  };
}

function componentEditableHost(
  path: NodePath<JSXElement>,
): ComponentEditableHost | null {
  const opening = path.node.openingElement;
  const editableAttribute = dataEditableAttribute(opening);
  const editableExpression = editableAttribute
    ? expressionFromAttribute(editableAttribute)
    : null;
  if (editableExpression?.type !== 'Identifier') return null;

  const componentName = componentFunctionName(path);
  if (!componentName || componentName === 'Composition') return null;
  const mediaType = descendantMediaType(path);
  if (mediaType) {
    let mediaOpening = mediaTypeFromName(jsxName(opening)) ? opening : null;
    if (!mediaOpening) {
      path.traverse({
        JSXOpeningElement(innerPath) {
          if (!mediaOpening && mediaTypeFromName(jsxName(innerPath.node))) {
            mediaOpening = innerPath.node;
          }
        },
      });
    }
    const sourceAttribute = mediaOpening
      ? namedAttribute(mediaOpening, 'src')
      : null;
    const sourceExpression = sourceAttribute
      ? expressionFromAttribute(sourceAttribute)
      : null;
    if (sourceExpression?.type !== 'Identifier') return null;
    return {
      componentName,
      idParam: editableExpression.name,
      valueParam: sourceExpression.name,
      type: mediaType,
    };
  }

  let valueParam: string | null = null;
  const inspectChildren = (element: JSXElement) => {
    for (const child of element.children) {
      if (
        child.type === 'JSXExpressionContainer'
        && child.expression.type === 'Identifier'
        && child.expression.name !== editableExpression.name
      ) {
        valueParam = child.expression.name;
        return;
      }
    }
  };
  inspectChildren(path.node);
  if (!valueParam) {
    path.traverse({
      JSXElement(innerPath) {
        if (!valueParam) inspectChildren(innerPath.node);
      },
    });
  }
  return valueParam
    ? {
        componentName,
        idParam: editableExpression.name,
        valueParam,
        type: 'text',
      }
    : null;
}

function usageCandidate(
  opening: JSXOpeningElement,
  host: ComponentEditableHost,
  ast: ReturnType<typeof parse>,
  code: string,
  props: Record<string, unknown> | undefined,
): Candidate | null {
  const idAttribute = namedAttribute(opening, host.idParam);
  const valueAttribute = namedAttribute(opening, host.valueParam);
  if (!idAttribute || !valueAttribute) return null;

  const staticId = staticEditableId(idAttribute);
  const valueExpression = expressionFromAttribute(valueAttribute);
  const staticKey = staticPropKey(valueExpression);
  if (staticId && staticKey) {
    return {
      opening,
      type: host.type,
      staticIds: [staticId],
      propKeyById: new Map([[staticId, staticKey]]),
    };
  }

  const idExpression = attributeExpressionSource(idAttribute, code);
  const valuePropExpression = dynamicPropExpression(valueExpression, code);
  if (!idExpression || !valuePropExpression) return null;
  const propertyName = dynamicPropertyName(idExpression);
  if (!propertyName || valuePropExpression !== idExpression) return null;
  const ids = collectDynamicIds(ast, propertyName, props);
  return {
    opening,
    type: host.type,
    staticIds: ids,
    propKeyById: new Map(ids.map(id => [id, id])),
  };
}

function dynamicPropertyName(expression: string): string | null {
  return expression.match(/\.([A-Za-z_$][\w$]*)$/)?.[1]
    ?? expression.match(/\[['"]([A-Za-z_$][\w$]*)['"]\]$/)?.[1]
    ?? null;
}

function collectDynamicIds(
  ast: ReturnType<typeof parse>,
  propertyName: string,
  props: Record<string, unknown> | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  traverse(ast, {
    ObjectProperty(path) {
      const key = path.node.key;
      const name = !path.node.computed && key.type === 'Identifier'
        ? key.name
        : key.type === 'StringLiteral'
          ? key.value
          : null;
      const value = path.node.value;
      if (name !== propertyName || value.type !== 'StringLiteral') return;
      if (props && !Object.prototype.hasOwnProperty.call(props, value.value)) return;
      if (!seen.has(value.value)) {
        seen.add(value.value);
        ids.push(value.value);
      }
    },
  });

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        key === propertyName
        && typeof child === 'string'
        && (!props || Object.prototype.hasOwnProperty.call(props, child))
        && !seen.has(child)
      ) {
        seen.add(child);
        ids.push(child);
      }
      visit(child);
    }
  };
  visit(props);
  return ids;
}

function insertionFor(opening: JSXOpeningElement, id: string): SourceInsertion | null {
  if (opening.end == null) return null;
  const closeLength = opening.selfClosing ? 2 : 1;
  return {
    offset: opening.end - closeLength,
    text: ` data-editable="${id}"`,
  };
}

function expressionInsertionFor(
  opening: JSXOpeningElement,
  attributeName: string,
  expression: string,
): SourceInsertion | null {
  if (opening.end == null) return null;
  const closeLength = opening.selfClosing ? 2 : 1;
  return {
    offset: opening.end - closeLength,
    text: ` ${attributeName}={${expression}}`,
  };
}

function stringAttributeInsertionFor(
  opening: JSXOpeningElement,
  attributeName: string,
  value: string,
): SourceInsertion | null {
  if (opening.end == null) return null;
  const closeLength = opening.selfClosing ? 2 : 1;
  return {
    offset: opening.end - closeLength,
    text: ` ${attributeName}=${JSON.stringify(value)}`,
  };
}

function applyInsertions(code: string, insertions: SourceInsertion[]): string {
  return [...insertions]
    .sort((a, b) => b.offset - a.offset)
    .reduce(
      (current, insertion) =>
        `${current.slice(0, insertion.offset)}${insertion.text}${current.slice(insertion.end ?? insertion.offset)}`,
      code,
    );
}

function addCandidateFields(
  fields: EditableField[],
  seen: Set<string>,
  candidate: Candidate,
  explicitById: Map<string, EditableField>,
) {
  for (const id of candidate.staticIds) {
    if (!id || seen.has(id)) continue;
    const explicit = explicitById.get(id);
    fields.push(explicit ?? {
      id,
      type: candidate.type,
      label: humanizeId(id),
      propKey: candidate.propKeyById.get(id) ?? id,
      ...(candidate.sourceById?.get(id)
        ? { source: candidate.sourceById.get(id) }
        : {}),
    });
    seen.add(id);
  }
}

export function compileEditableManifest({
  code,
  props,
  editables,
}: EditableManifestInput): EditableManifestResult {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
  } catch (error) {
    return {
      code,
      editables: editables ?? [],
      diagnostics: [
        `Editable Manifest compile failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      coverage: {
        visibleSinks: 0,
        editable: editables?.length ?? 0,
        ignored: 0,
        unsupported: ['Composition syntax could not be analyzed.'],
      },
    };
  }

  const diagnostics: string[] = [];
  const candidates: Candidate[] = [];
  const insertions: SourceInsertion[] = [];
  const insertedOpenings = new Set<JSXOpeningElement>();
  const componentHosts = new Map<string, ComponentEditableHost[]>();
  const componentHostOpenings = new Set<JSXOpeningElement>();
  const naturalHosts: NaturalComponentHost[] = [];

  traverse(ast, {
    JSXElement(path) {
      const host = naturalComponentHost(path);
      if (host) naturalHosts.push(host);
    },
  });
  const naturalHostOpenings = new Set(naturalHosts.map(host => host.opening));

  const naturalCallsByComponent = new Map<string, NaturalComponentCall[]>();
  traverse(ast, {
    JSXOpeningElement(path) {
      const componentName = jsxName(path.node);
      if (!componentName || /^[a-z]/.test(componentName)) return;
      const elementPath = path.parentPath;
      const parentComponentName = elementPath?.isJSXElement()
        ? componentFunctionName(elementPath)
        : null;
      const parentObjectPattern = elementPath?.isJSXElement()
        ? componentObjectPattern(elementPath)
        : null;
      const calls = naturalCallsByComponent.get(componentName) ?? [];
      calls.push({
        path,
        opening: path.node,
        parentComponentName,
        parentObjectPattern,
      });
      naturalCallsByComponent.set(componentName, calls);
    },
  });
  const isUnrenderedHelper = (path: NodePath<JSXElement>): boolean => {
    const componentName = componentFunctionName(path);
    return Boolean(
      componentName
      && componentName !== 'Composition'
      && componentName !== 'Design'
      && !naturalCallsByComponent.has(componentName),
    );
  };

  const reservedIds = new Set([
    ...Object.keys(props ?? {}),
    ...(editables ?? []).map(field => field.id),
  ]);
  const literalIdsByUsage = new Map<string, string>();
  const generatedStemCounts = new Map<string, number>();
  const claimGeneratedTextId = (
    path: NodePath<JSXElement>,
    name: string,
  ): string => {
    const owner = lowerCamel(componentFunctionName(path) ?? 'composition');
    const stem = `${owner}${generatedTextStem(name)}`;
    const nextCount = (generatedStemCounts.get(stem) ?? 0) + 1;
    generatedStemCounts.set(stem, nextCount);
    const rawBase = nextCount === 1 ? stem : `${stem}${nextCount}`;
    let id = rawBase;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `${rawBase}${suffix}`;
      suffix++;
    }
    reservedIds.add(id);
    return id;
  };
  const claimReservedId = (rawBase: string): string => {
    const base = identifierFragment(rawBase) || 'editableText';
    let id = base;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `${base}${suffix}`;
      suffix++;
    }
    reservedIds.add(id);
    return id;
  };
  const staticArrayFromMapItem = (
    callPath: NodePath<JSXOpeningElement>,
    itemName: string,
  ): { name: string; expression: Node } | null => {
    const functionPath = callPath.getFunctionParent();
    if (
      !functionPath?.isArrowFunctionExpression()
      || functionPath.node.params[0]?.type !== 'Identifier'
      || functionPath.node.params[0].name !== itemName
      || !functionPath.parentPath?.isCallExpression()
    ) {
      return null;
    }
    const callee = functionPath.parentPath.node.callee;
    if (
      callee.type !== 'MemberExpression'
      || callee.computed
      || callee.property.type !== 'Identifier'
      || callee.property.name !== 'map'
      || callee.object.type !== 'Identifier'
    ) {
      return null;
    }
    const binding = callPath.scope.getBinding(callee.object.name);
    if (
      !binding?.constant
      || !binding.path.isVariableDeclarator()
      || binding.path.node.init?.type !== 'ArrayExpression'
    ) {
      return null;
    }
    return {
      name: callee.object.name,
      expression: binding.path.node.init,
    };
  };
  const resolveStaticCollectionText = (
    path: NodePath<JSXElement>,
    expression: MemberExpression,
  ): Candidate | null => {
    if (
      expression.object.type !== 'Identifier'
      || expression.computed
      || expression.property.type !== 'Identifier'
      || !props
    ) {
      return null;
    }
    let arrayName = 'items';
    let arrayExpression: Node | null = null;
    const resolveArrayBinding = (name: string): Node | null => {
      const binding = path.scope.getBinding(name);
      if (
        binding?.constant
        && binding.path.isVariableDeclarator()
        && binding.path.node.init?.type === 'ArrayExpression'
      ) {
        arrayName = name;
        return binding.path.node.init;
      }
      return null;
    };
    const sourceCollectionName = (node: Node | null | undefined): string | null => {
      if (!node) return null;
      if (
        node.type === 'CallExpression'
        && node.callee.type === 'MemberExpression'
        && node.callee.object.type === 'Identifier'
        && node.callee.property.type === 'Identifier'
        && ['find', 'filter', 'at'].includes(node.callee.property.name)
      ) {
        return node.callee.object.name;
      }
      if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
        return node.object.name;
      }
      if (node.type === 'LogicalExpression') {
        return sourceCollectionName(node.left) ?? sourceCollectionName(node.right);
      }
      if (node.type === 'ConditionalExpression') {
        return sourceCollectionName(node.consequent)
          ?? sourceCollectionName(node.alternate);
      }
      return null;
    };

    const functionPath = path.getFunctionParent();
    const isMapItem = (
      functionPath?.isArrowFunctionExpression()
      && functionPath.node.params[0]?.type === 'Identifier'
      && functionPath.node.params[0].name === expression.object.name
      && functionPath.parentPath?.isCallExpression()
    );
    if (isMapItem && functionPath?.parentPath?.isCallExpression()) {
      const callee = functionPath.parentPath.node.callee;
      if (
        callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property.type === 'Identifier'
        && callee.property.name === 'map'
      ) {
        if (callee.object.type === 'ArrayExpression') {
          arrayExpression = callee.object;
        } else if (callee.object.type === 'Identifier') {
          arrayExpression = resolveArrayBinding(callee.object.name);
        }
      }
    }
    if (!arrayExpression) {
      const itemBinding = path.scope.getBinding(expression.object.name);
      const initializer = itemBinding?.constant
        && itemBinding.path.isVariableDeclarator()
        ? itemBinding.path.node.init
        : null;
      const sourceName = sourceCollectionName(initializer);
      if (sourceName) arrayExpression = resolveArrayBinding(sourceName);
    }
    if (!arrayExpression) {
      const helperName = componentFunctionName(path);
      for (const call of helperName
        ? naturalCallsByComponent.get(helperName) ?? []
        : []) {
        const itemExpression = expressionFromAttribute(
          namedAttribute(call.opening, expression.object.name),
        );
        if (itemExpression?.type !== 'Identifier') continue;
        const source = staticArrayFromMapItem(call.path, itemExpression.name);
        if (!source) continue;
        arrayName = source.name;
        arrayExpression = source.expression;
        break;
      }
    }
    if (!arrayExpression || arrayExpression.type !== 'ArrayExpression') return null;

    const valueProperty = expression.property.name;
    const markerProperty = `__makaronEditable_${valueProperty.replace(/[^\w$]/g, '_')}`;
    const ids: string[] = [];
    for (const [index, item] of arrayExpression.elements.entries()) {
      if (!item || item.type !== 'ObjectExpression') return null;
      const propertyByName = (name: string) => item.properties.find(property => {
        if (property.type !== 'ObjectProperty' || property.computed) return false;
        return (
          (property.key.type === 'Identifier' && property.key.name === name)
          || (property.key.type === 'StringLiteral' && property.key.value === name)
        );
      });
      const valueNode = propertyByName(valueProperty);
      if (!valueNode || valueNode.type !== 'ObjectProperty') return null;
      const literalValue = staticTextExpressionValue(path, valueNode.value);
      if (!literalValue?.trim()) return null;

      const existingMarker = propertyByName(markerProperty);
      const existingId = existingMarker?.type === 'ObjectProperty'
        && existingMarker.value.type === 'StringLiteral'
        ? existingMarker.value.value
        : null;
      const stableKeyNode = propertyByName('id') ?? propertyByName('key');
      const stableKey = stableKeyNode?.type === 'ObjectProperty'
        ? staticTextExpressionValue(path, stableKeyNode.value)
        : null;
      const normalizedArrayName = /^[A-Z0-9_]+$/.test(arrayName)
        ? arrayName.toLowerCase()
        : arrayName;
      const singular = normalizedArrayName.replace(/(?:ies|s)$/i, match =>
        match.toLowerCase() === 'ies' ? 'y' : ''
      ) || 'item';
      const owner = stableKey
        ? identifierFragment(stableKey)
        : `${identifierFragment(singular) || 'item'}${index + 1}`;
      const generatedId = existingId ?? claimReservedId(
        `${owner}${semanticParamName(valueProperty)}`,
      );
      reservedIds.add(generatedId);
      ids.push(generatedId);
      if (props[generatedId] === undefined) props[generatedId] = literalValue;
      if (!existingMarker && item.end != null) {
        insertions.push({
          offset: item.end - 1,
          text: `${item.properties.length > 0 ? ', ' : ''}${markerProperty}: ${JSON.stringify(generatedId)}`,
        });
      }
    }
    if (ids.length === 0) return null;
    const markerExpression = `${expression.object.name}.${markerProperty}`;
    const markerInsertion = expressionInsertionFor(
      path.node.openingElement,
      'data-editable',
      markerExpression,
    );
    if (markerInsertion) insertions.push(markerInsertion);
    return {
      opening: path.node.openingElement,
      type: 'text',
      staticIds: ids,
      propKeyById: new Map(ids.map(id => [id, id])),
      sourceById: new Map(ids.map(id => [id, 'literal'])),
    };
  };
  const resolveRuntimeCollectionText = (
    path: NodePath<JSXElement>,
    expression: MemberExpression,
  ): Candidate | null => {
    if (
      expression.object.type !== 'Identifier'
      || expression.computed
      || expression.property.type !== 'Identifier'
      || !props
    ) {
      return null;
    }
    const itemParamName = expression.object.name;
    const collectionKeyFromMap = (
      functionPath: NodePath | null,
      itemName: string,
    ): string | null => {
      if (
        !functionPath?.isArrowFunctionExpression()
        || functionPath.node.params[0]?.type !== 'Identifier'
        || functionPath.node.params[0].name !== itemName
        || !functionPath.parentPath?.isCallExpression()
      ) {
        return null;
      }
      const callee = functionPath.parentPath.node.callee;
      if (
        callee.type !== 'MemberExpression'
        || callee.computed
        || callee.property.type !== 'Identifier'
        || callee.property.name !== 'map'
      ) {
        return null;
      }
      return staticPropKey(callee.object);
    };

    let collectionKey = collectionKeyFromMap(
      path.getFunctionParent(),
      itemParamName,
    );
    if (!collectionKey) {
      const helperName = componentFunctionName(path);
      if (helperName) {
        traverse(ast, {
          JSXOpeningElement(callPath) {
            if (collectionKey || jsxName(callPath.node) !== helperName) return;
            const itemAttribute = namedAttribute(
              callPath.node,
              itemParamName,
            );
            const itemExpression = expressionFromAttribute(itemAttribute);
            if (itemExpression?.type !== 'Identifier') return;
            collectionKey = collectionKeyFromMap(
              callPath.getFunctionParent(),
              itemExpression.name,
            );
          },
        });
      }
    }
    const originalItems = collectionKey ? props[collectionKey] : null;
    if (
      !collectionKey
      || !Array.isArray(originalItems)
      || !originalItems.every(item => item && typeof item === 'object' && !Array.isArray(item))
    ) {
      return null;
    }
    const resolvedCollectionKey = collectionKey;
    const valueProperty = expression.property.name;
    const markerProperty = `__makaronEditable_${valueProperty.replace(/[^\w$]/g, '_')}`;
    const ids: string[] = [];
    const nextItems = originalItems.map((item, index) => {
      const record = item as Record<string, unknown>;
      const literalValue = record[valueProperty];
      if (typeof literalValue !== 'string' && typeof literalValue !== 'number') {
        return null;
      }
      const stableKey = typeof record.id === 'string'
        ? record.id
        : typeof record.key === 'string'
          ? record.key
          : null;
      const singular = resolvedCollectionKey.replace(/(?:ies|s)$/i, match =>
        match.toLowerCase() === 'ies' ? 'y' : ''
      ) || 'item';
      const owner = stableKey
        ? identifierFragment(stableKey)
        : `${identifierFragment(singular) || 'item'}${index + 1}`;
      const existingId = typeof record[markerProperty] === 'string'
        ? record[markerProperty] as string
        : null;
      const id = existingId ?? claimReservedId(
        `${owner}${semanticParamName(valueProperty)}`,
      );
      reservedIds.add(id);
      ids.push(id);
      if (props[id] === undefined) props[id] = literalValue;
      return { ...record, [markerProperty]: id };
    });
    if (nextItems.some(item => item === null) || ids.length === 0) return null;
    props[resolvedCollectionKey] = nextItems;
    const markerExpression = `${expression.object.name}.${markerProperty}`;
    const markerInsertion = expressionInsertionFor(
      path.node.openingElement,
      'data-editable',
      markerExpression,
    );
    if (markerInsertion) insertions.push(markerInsertion);
    return {
      opening: path.node.openingElement,
      type: 'text',
      staticIds: ids,
      propKeyById: new Map(ids.map(id => [id, id])),
      sourceById: new Map(ids.map(id => [id, 'literal'])),
    };
  };
  const resolveStaticIndexedText = (
    path: NodePath<JSXElement>,
    expression: MemberExpression,
  ): Candidate | null => {
    if (
      expression.object.type !== 'Identifier'
      || !expression.computed
      || expression.property.type !== 'NumericLiteral'
      || !Number.isInteger(expression.property.value)
      || !props
    ) {
      return null;
    }
    const binding = path.scope.getBinding(expression.object.name);
    if (
      !binding?.constant
      || !binding.path.isVariableDeclarator()
      || binding.path.node.init?.type !== 'ArrayExpression'
    ) {
      return null;
    }
    const index = expression.property.value;
    const element = binding.path.node.init.elements[index];
    const value = staticTextExpressionValue(path, element);
    if (!value?.trim()) return null;
    const singular = expression.object.name.replace(/(?:ies|s)$/i, match =>
      match.toLowerCase() === 'ies' ? 'y' : ''
    ) || 'item';
    const id = claimReservedId(`${singular}${index + 1}Text`);
    if (props[id] === undefined) props[id] = value;
    const insertion = insertionFor(path.node.openingElement, id);
    if (insertion) insertions.push(insertion);
    return {
      opening: path.node.openingElement,
      type: 'text',
      staticIds: [id],
      propKeyById: new Map([[id, id]]),
      sourceById: new Map([[id, 'literal']]),
    };
  };
  const resolvePrimitiveMapText = (
    path: NodePath<JSXElement>,
    expression: Node,
  ): Candidate | null => {
    if (expression.type !== 'Identifier' || !props) return null;
    const functionPath = path.getFunctionParent();
    if (
      !functionPath?.isArrowFunctionExpression()
      || functionPath.node.params[0]?.type !== 'Identifier'
      || functionPath.node.params[0].name !== expression.name
      || functionPath.node.params[1]?.type !== 'Identifier'
      || !functionPath.parentPath?.isCallExpression()
    ) {
      return null;
    }
    const indexName = functionPath.node.params[1].name;
    const callee = functionPath.parentPath.node.callee;
    if (
      callee.type !== 'MemberExpression'
      || callee.computed
      || callee.property.type !== 'Identifier'
      || callee.property.name !== 'map'
    ) {
      return null;
    }

    let collectionName = 'items';
    let values: unknown[] | null = null;
    if (callee.object.type === 'ArrayExpression') {
      values = callee.object.elements.map(element =>
        staticTextExpressionValue(path, element)
      );
    } else if (callee.object.type === 'Identifier') {
      collectionName = callee.object.name;
      const binding = path.scope.getBinding(collectionName);
      if (
        binding?.constant
        && binding.path.isVariableDeclarator()
        && binding.path.node.init?.type === 'ArrayExpression'
      ) {
        values = binding.path.node.init.elements.map(element =>
          staticTextExpressionValue(path, element)
        );
      }
    } else {
      const propKey = staticPropKey(callee.object);
      const propValues = propKey ? props[propKey] : null;
      if (propKey && Array.isArray(propValues)) {
        collectionName = propKey;
        values = propValues;
      }
    }
    if (
      !values
      || values.length === 0
      || !values.every(value =>
        (typeof value === 'string' && value.trim().length > 0)
        || typeof value === 'number'
      )
    ) {
      return null;
    }

    const singular = collectionName.replace(/(?:ies|s)$/i, match =>
      match.toLowerCase() === 'ies' ? 'y' : ''
    ) || expression.name || 'item';
    const ids = values.map((value, index) => {
      const id = claimReservedId(`${singular}${index + 1}`);
      if (props[id] === undefined) props[id] = value;
      return id;
    });
    const markerExpression = ids.reduceRight(
      (alternate, id, index) =>
        index === ids.length - 1
          ? JSON.stringify(id)
          : `${indexName} === ${index} ? ${JSON.stringify(id)} : ${alternate}`,
      JSON.stringify(ids[ids.length - 1]),
    );
    const insertion = expressionInsertionFor(
      path.node.openingElement,
      'data-editable',
      markerExpression,
    );
    if (insertion) insertions.push(insertion);
    return {
      opening: path.node.openingElement,
      type: 'text',
      staticIds: ids,
      propKeyById: new Map(ids.map(id => [id, id])),
      sourceById: new Map(ids.map(id => [id, 'literal'])),
    };
  };
  const resolveConditionalLiteralText = (
    path: NodePath<JSXElement>,
    expression: Node,
  ): Candidate | null => {
    if (expression.type !== 'ConditionalExpression' || !props) return null;
    const leaves = conditionalLiteralLeaves(expression);
    if (!leaves?.length || leaves.some(leaf => !leaf.value.trim())) return null;
    const ids = leaves.map(() =>
      claimGeneratedTextId(path, jsxName(path.node.openingElement))
    );
    leaves.forEach((leaf, index) => {
      if (props[ids[index]] === undefined) props[ids[index]] = leaf.value;
    });
    const idByNode = new Map(leaves.map((leaf, index) => [leaf.node, ids[index]]));
    const markerSource = (node: Node): string | null => {
      const id = idByNode.get(node);
      if (id) return JSON.stringify(id);
      if (
        node.type !== 'ConditionalExpression'
        || node.test.start == null
        || node.test.end == null
      ) {
        return null;
      }
      const consequent = markerSource(node.consequent);
      const alternate = markerSource(node.alternate);
      if (!consequent || !alternate) return null;
      const condition = code.slice(node.test.start, node.test.end);
      return `${condition} ? ${consequent} : ${alternate}`;
    };
    const markerExpression = markerSource(expression);
    if (!markerExpression) return null;
    const insertion = expressionInsertionFor(
      path.node.openingElement,
      'data-editable',
      markerExpression,
    );
    if (insertion) insertions.push(insertion);
    return {
      opening: path.node.openingElement,
      type: 'text',
      staticIds: ids,
      propKeyById: new Map(ids.map(id => [id, id])),
      sourceById: new Map(ids.map(id => [id, 'literal'])),
    };
  };
  const claimLiteralId = (
    call: NaturalComponentCall,
    valueParam: string,
    markerParam: string,
  ): string => {
    const existingId = staticEditableId(namedAttribute(call.opening, markerParam));
    if (existingId) {
      reservedIds.add(existingId);
      return existingId;
    }
    const usageKey = `${call.opening.start}:${valueParam}`;
    const claimed = literalIdsByUsage.get(usageKey);
    if (claimed) return claimed;

    const ownerName = call.parentComponentName === 'Composition'
      ? valueParam
      : lowerCamel(call.parentComponentName ?? valueParam);
    const rawBase = call.parentComponentName === 'Composition'
      ? lowerCamel(valueParam)
      : `${ownerName}${semanticParamName(valueParam)}`;
    const base = rawBase || 'editableText';
    let id = base;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `${base}${suffix}`;
      suffix++;
    }
    reservedIds.add(id);
    literalIdsByUsage.set(usageKey, id);
    return id;
  };

  const resolveNaturalUsages = (
    host: NaturalComponentHost,
  ): NaturalResolvedUsage[] => {
    const resolved: NaturalResolvedUsage[] = [];
    const queue: Array<{
      componentName: string;
      valueParam: string;
      markerParam: string;
      edges: NaturalPropagationEdge[];
      seen: Set<string>;
    }> = [{
      componentName: host.componentName,
      valueParam: host.valueParam,
      markerParam: host.markerParam,
      edges: [],
      seen: new Set([`${host.componentName}:${host.valueParam}`]),
    }];

    const resolveComputedPropMap = (
      call: NaturalComponentCall,
      expression: MemberExpression,
    ): { propKeys: string[]; markerExpression: string } | null => {
      if (
        !expression.computed
        || expression.object.type !== 'Identifier'
        || expression.property.start == null
        || expression.property.end == null
      ) {
        return null;
      }
      const binding = call.path.scope.getBinding(expression.object.name);
      if (
        !binding?.constant
        || !binding.path.isVariableDeclarator()
        || binding.path.node.init?.type !== 'ObjectExpression'
      ) {
        return null;
      }
      const propKeys: string[] = [];
      for (const property of binding.path.node.init.properties) {
        if (property.type !== 'ObjectProperty' || property.computed) return null;
        const key = property.key.type === 'Identifier'
          ? property.key.name
          : property.key.type === 'StringLiteral'
            ? property.key.value
            : null;
        const propKey = staticPropKey(property.value);
        if (
          !key
          || !propKey
          || key !== propKey
          || (props && !Object.prototype.hasOwnProperty.call(props, propKey))
        ) {
          return null;
        }
        propKeys.push(propKey);
      }
      if (propKeys.length === 0) return null;
      return {
        propKeys: [...new Set(propKeys)],
        markerExpression: code.slice(
          expression.property.start,
          expression.property.end,
        ),
      };
    };

    while (queue.length > 0) {
      const state = queue.shift();
      if (!state) break;
      for (const call of naturalCallsByComponent.get(state.componentName) ?? []) {
        const valueAttribute = namedAttribute(call.opening, state.valueParam);
        const valueExpression = expressionFromAttribute(valueAttribute);
        const propKey = staticPropKey(valueExpression);
        if (
          propKey
          && (!props || Object.prototype.hasOwnProperty.call(props, propKey))
        ) {
          resolved.push({
            opening: call.opening,
            markerParam: state.markerParam,
            propKey,
            edges: state.edges,
          });
          continue;
        }
        if (valueExpression?.type === 'MemberExpression') {
          const computed = resolveComputedPropMap(call, valueExpression);
          if (computed) {
            computed.propKeys.forEach((computedPropKey, index) => {
              resolved.push({
                opening: call.opening,
                markerParam: state.markerParam,
                markerExpression: index === 0
                  ? computed.markerExpression
                  : undefined,
                propKey: computedPropKey,
                edges: state.edges,
              });
            });
            continue;
          }
        }
        const literalValue = staticStringAttributeValue(valueAttribute);
        if (literalValue?.trim() && props) {
          const literalId = claimLiteralId(
            call,
            state.valueParam,
            state.markerParam,
          );
          if (props[literalId] === undefined) props[literalId] = literalValue;
          resolved.push({
            opening: call.opening,
            markerParam: state.markerParam,
            propKey: literalId,
            source: 'literal',
            literalValue,
            edges: state.edges,
          });
          continue;
        }
        if (valueExpression?.type !== 'Identifier') continue;
        if (
          call.parentComponentName === 'Composition'
          && (!props || Object.prototype.hasOwnProperty.call(props, valueExpression.name))
        ) {
          resolved.push({
            opening: call.opening,
            markerParam: state.markerParam,
            propKey: valueExpression.name,
            edges: state.edges,
          });
          continue;
        }
        if (
          !call.parentComponentName
          || !call.parentObjectPattern
          || !objectPatternParamNames(call.parentObjectPattern).has(valueExpression.name)
        ) {
          continue;
        }

        const parentMarkerParam =
          `__makaronEditable_${valueExpression.name.replace(/[^\w$]/g, '_')}`;
        const stateKey = `${call.parentComponentName}:${valueExpression.name}`;
        if (state.seen.has(stateKey)) continue;
        queue.push({
          componentName: call.parentComponentName,
          valueParam: valueExpression.name,
          markerParam: parentMarkerParam,
          edges: [
            ...state.edges,
            {
              opening: call.opening,
              childMarkerParam: state.markerParam,
              parentMarkerParam,
              parentObjectPattern: call.parentObjectPattern,
            },
          ],
          seen: new Set([...state.seen, stateKey]),
        });
      }
    }

    return resolved;
  };

  const patternMarkers = new Map<ObjectPattern, Set<string>>();
  const instrumentedNaturalUsages = new Set<string>();
  const migratedNaturalOpenings = new Set<JSXOpeningElement>();
  for (const host of naturalHosts) {
    const usages = resolveNaturalUsages(host);
    if (usages.length === 0) continue;
    if (!dataEditableAttribute(host.opening)) {
      const markerInsertion = expressionInsertionFor(
        host.opening,
        'data-editable',
        host.markerParam,
      );
      if (markerInsertion) insertions.push(markerInsertion);
    }
    if (
      host.staleMediaMarker?.start != null
      && host.staleMediaMarker.end != null
      && host.mediaOpening
    ) {
      insertions.push({
        offset: host.staleMediaMarker.start,
        end: host.staleMediaMarker.end,
        text: '',
      });
      migratedNaturalOpenings.add(host.mediaOpening);
    }

    const markers = patternMarkers.get(host.objectPattern) ?? new Set<string>();
    if (!objectPatternParamNames(host.objectPattern).has(host.markerParam)) {
      markers.add(host.markerParam);
    }
    patternMarkers.set(host.objectPattern, markers);

    for (const usage of usages) {
      for (const edge of usage.edges) {
        const edgeMarkers = patternMarkers.get(edge.parentObjectPattern)
          ?? new Set<string>();
        if (!objectPatternParamNames(edge.parentObjectPattern).has(edge.parentMarkerParam)) {
          edgeMarkers.add(edge.parentMarkerParam);
        }
        patternMarkers.set(edge.parentObjectPattern, edgeMarkers);

        const edgeKey = `${edge.opening.start}:${edge.childMarkerParam}`;
        if (
          !instrumentedNaturalUsages.has(edgeKey)
          && !namedAttribute(edge.opening, edge.childMarkerParam)
        ) {
          const insertion = expressionInsertionFor(
            edge.opening,
            edge.childMarkerParam,
            edge.parentMarkerParam,
          );
          if (insertion) insertions.push(insertion);
          instrumentedNaturalUsages.add(edgeKey);
        }
      }

      const usageKey = `${usage.opening.start}:${usage.markerParam}`;
      if (
        !instrumentedNaturalUsages.has(usageKey)
        && !namedAttribute(usage.opening, usage.markerParam)
      ) {
        const insertion = usage.markerExpression
          ? expressionInsertionFor(
              usage.opening,
              usage.markerParam,
              usage.markerExpression,
            )
          : stringAttributeInsertionFor(
              usage.opening,
              usage.markerParam,
              usage.propKey,
            );
        if (insertion) insertions.push(insertion);
        instrumentedNaturalUsages.add(usageKey);
      }
      if (host.type === 'video' && host.mediaOpening && props) {
        const authoredStart = numericAttribute(host.mediaOpening, 'trimBefore');
        const authoredEnd = numericAttribute(host.mediaOpening, 'trimAfter');
        const startKey = `_trimBefore_${usage.propKey}`;
        const endKey = `_trimAfter_${usage.propKey}`;
        if (authoredStart !== undefined && props[startKey] === undefined) {
          props[startKey] = authoredStart;
        }
        if (authoredEnd !== undefined && props[endKey] === undefined) {
          props[endKey] = authoredEnd;
        }
      }
    }
    const ids = usages.map(usage => usage.propKey);
    candidates.push({
      opening: host.opening,
      type: host.type,
      staticIds: ids,
      propKeyById: new Map(ids.map(id => [id, id])),
      sourceById: new Map(
        usages
          .filter(usage => usage.source)
          .map(usage => [usage.propKey, usage.source]),
      ),
    });
  }
  for (const [pattern, markers] of patternMarkers) {
    if (pattern.end == null || markers.size === 0) continue;
    insertions.push({
      offset: pattern.end - 1,
      text: `, ${[...markers].join(', ')}`,
    });
  }

  traverse(ast, {
    JSXElement(path) {
      if (!dataEditableAttribute(path.node.openingElement)) return;
      if (naturalHostOpenings.has(path.node.openingElement)) return;
      if (migratedNaturalOpenings.has(path.node.openingElement)) return;
      const host = componentEditableHost(path);
      if (host) {
        const hosts = componentHosts.get(host.componentName) ?? [];
        hosts.push(host);
        componentHosts.set(host.componentName, hosts);
        componentHostOpenings.add(path.node.openingElement);
      }
    },
  });

  traverse(ast, {
    JSXElement(path) {
      if (isUnrenderedHelper(path)) return;
      const element = path.node;
      const opening = element.openingElement;
      const name = jsxName(opening);
      if (migratedNaturalOpenings.has(opening)) return;
      if (componentHostOpenings.has(opening)) return;
      if (namedAttribute(opening, 'data-editable-ignore')) return;
      const matchingComponentHosts = componentHosts.get(name);
      if (matchingComponentHosts) {
        for (const componentHost of matchingComponentHosts) {
          const candidate = usageCandidate(opening, componentHost, ast, code, props);
          if (candidate) {
            candidates.push(candidate);
          } else if (!editables?.length) {
            diagnostics.push(
              `Editable helper <${name}> must receive ${componentHost.idParam} and ${componentHost.valueParam} from the same top-level props key.`,
            );
          }
        }
        return;
      }
      const explicitAttribute = dataEditableAttribute(opening);
      const explicitStaticId = staticEditableId(explicitAttribute);
      const explicitExpressionNode = expressionFromAttribute(explicitAttribute);
      const explicitExpression = attributeExpressionSource(explicitAttribute, code);
      const mediaType = descendantMediaType(path);
      const directReads = directTextPropReads(element);
      const directStaticKeys = directReads
        .map(read => staticPropKey(read))
        .filter((key): key is string => Boolean(key));

      if (explicitAttribute) {
        const type = mediaType ?? 'text';
        const ids: string[] = [];
        const propKeyById = new Map<string, string>();
        if (explicitStaticId) {
          ids.push(explicitStaticId);
          const nestedTextKeys = descendantTextPropKeys(path);
          propKeyById.set(
            explicitStaticId,
            directStaticKeys[0]
              ?? descendantMediaPropKey(path)
              ?? (nestedTextKeys.length === 1 ? nestedTextKeys[0] : undefined)
              ?? explicitStaticId,
          );
        } else if (explicitExpression) {
          for (const id of staticEditableIdsFromExpression(explicitExpressionNode)) {
            if (!ids.includes(id)) {
              ids.push(id);
              propKeyById.set(id, id);
            }
          }
          const propertyName = dynamicPropertyName(explicitExpression);
          if (propertyName) {
            for (const id of collectDynamicIds(ast, propertyName, props)) {
              ids.push(id);
              propKeyById.set(id, id);
            }
          }
        }
        if (ids.length > 0) {
          candidates.push({
            opening,
            type,
            staticIds: ids,
            propKeyById,
          });
        } else if (!editables?.length) {
          diagnostics.push(
            `Could not infer editable ids for <${name}>. Use a static id or pair data-editable={scene.key} with props[scene.key].`,
          );
        }
        return;
      }

      const editableAncestor = path.findParent(parent =>
        parent.isJSXElement()
        && Boolean(dataEditableAttribute(parent.node.openingElement))
      );
      if (editableAncestor) return;

      const directUniqueKeys = [...new Set(directStaticKeys)];
      if (directUniqueKeys.length > 1) {
        diagnostics.push(
          `JSX host <${name}> renders multiple editable props (${directUniqueKeys.join(', ')}). Wrap each value in its own element or add an explicit data-editable host.`,
        );
        return;
      }

      const directKey = directUniqueKeys[0];
      if (directKey) {
        if (STRUCTURAL_TEXT_HOSTS.has(name)) {
          diagnostics.push(
            `Structural host <${name}> renders editable prop ${directKey} directly. Wrap it in a semantic text element so it has its own selectable box.`,
          );
          return;
        }
        const insertion = insertionFor(opening, directKey);
        if (insertion) {
          insertions.push(insertion);
          insertedOpenings.add(opening);
        }
        candidates.push({
          opening,
          type: 'text',
          staticIds: [directKey],
          propKeyById: new Map([[directKey, directKey]]),
          instrumentId: directKey,
        });
        return;
      }

      const directMember = element.children
        .filter(child => child.type === 'JSXExpressionContainer')
        .map(child => child.expression)
        .find((expression): expression is MemberExpression =>
          expression.type === 'MemberExpression'
        );
      if (directMember) {
        const collectionCandidate = resolveRuntimeCollectionText(path, directMember)
          ?? resolveStaticCollectionText(path, directMember)
          ?? resolveStaticIndexedText(path, directMember);
        if (collectionCandidate) {
          candidates.push(collectionCandidate);
          return;
        }
      }

      const directIdentifier = element.children
        .filter(child => child.type === 'JSXExpressionContainer')
        .map(child => child.expression)
        .find(expression => expression.type === 'Identifier');
      if (directIdentifier) {
        const primitiveMapCandidate = resolvePrimitiveMapText(path, directIdentifier);
        if (primitiveMapCandidate) {
          candidates.push(primitiveMapCandidate);
          return;
        }
      }

      const directConditional = element.children
        .filter(child => child.type === 'JSXExpressionContainer')
        .map(child => child.expression)
        .find(expression => expression.type === 'ConditionalExpression');
      if (directConditional) {
        const conditionalCandidate = resolveConditionalLiteralText(
          path,
          directConditional,
        );
        if (conditionalCandidate) {
          candidates.push(conditionalCandidate);
          return;
        }
      }

      const directLiteral = directStaticTextValue(path);
      if (
        directLiteral?.trim()
        && props
        && /^[a-z]/.test(name)
        && !STRUCTURAL_TEXT_HOSTS.has(name)
      ) {
        const generatedId = claimGeneratedTextId(path, name);
        if (props[generatedId] === undefined) props[generatedId] = directLiteral;
        const insertion = insertionFor(opening, generatedId);
        if (insertion) {
          insertions.push(insertion);
          insertedOpenings.add(opening);
        }
        candidates.push({
          opening,
          type: 'text',
          staticIds: [generatedId],
          propKeyById: new Map([[generatedId, generatedId]]),
          sourceById: new Map([[generatedId, 'literal']]),
          instrumentId: generatedId,
        });
        return;
      }

      const ownMediaType = mediaTypeFromName(name);
      if (!ownMediaType) return;
      const sourceRead = mediaPropRead(opening);
      const sourceKey = staticPropKey(sourceRead);
      if (!sourceKey) return;
      if (!insertedOpenings.has(opening)) {
        const insertion = insertionFor(opening, sourceKey);
        if (insertion) insertions.push(insertion);
      }
      candidates.push({
        opening,
        type: ownMediaType,
        staticIds: [sourceKey],
        propKeyById: new Map([[sourceKey, sourceKey]]),
        instrumentId: sourceKey,
      });
      if (ownMediaType === 'video' && props) {
        const authoredStart = numericAttribute(opening, 'trimBefore');
        const authoredEnd = numericAttribute(opening, 'trimAfter');
        const startKey = `_trimBefore_${sourceKey}`;
        const endKey = `_trimAfter_${sourceKey}`;
        if (authoredStart !== undefined && props[startKey] === undefined) {
          props[startKey] = authoredStart;
        }
        if (authoredEnd !== undefined && props[endKey] === undefined) {
          props[endKey] = authoredEnd;
        }
      }
    },
  });

  candidates.sort((a, b) => (a.opening.start ?? 0) - (b.opening.start ?? 0));
  const explicitById = new Map((editables ?? []).map(field => [field.id, field]));
  const inferredFields: EditableField[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    addCandidateFields(inferredFields, seen, candidate, explicitById);
  }
  if (editables?.length) {
    const explicitOrder = new Map(editables.map((field, index) => [field.id, index]));
    inferredFields.sort((a, b) => {
      const aOrder = explicitOrder.get(a.id);
      const bOrder = explicitOrder.get(b.id);
      if (aOrder == null && bOrder == null) return 0;
      if (aOrder == null) return 1;
      if (bOrder == null) return -1;
      return aOrder - bOrder;
    });
  }
  const ownedOpenings = new Set(candidates.map(candidate => candidate.opening));
  const unsupported: string[] = [];
  let ignored = 0;
  traverse(ast, {
    JSXElement(path) {
      if (isUnrenderedHelper(path) || isChildrenPassThrough(path)) return;
      const opening = path.node.openingElement;
      const name = jsxName(opening);
      if (!/^[a-z]/.test(name) || !hasDirectTextLikeChild(path.node)) return;
      if (namedAttribute(opening, 'data-editable-ignore')) {
        ignored++;
        return;
      }
      if (ownedOpenings.has(opening) || dataEditableAttribute(opening)) return;
      const editableAncestor = path.findParent(parent =>
        parent.isJSXElement()
        && (
          Boolean(dataEditableAttribute(parent.node.openingElement))
          || ownedOpenings.has(parent.node.openingElement)
        )
      );
      if (editableAncestor) return;
      const line = opening.loc?.start.line;
      unsupported.push(
        `<${name}>${line ? ` at line ${line}` : ''} has visible text that could not be assigned a stable editable id.`,
      );
    },
  });
  if (unsupported.length > 0 && diagnostics.length === 0) {
    diagnostics.push(
      `Editable coverage incomplete: ${unsupported.join(' ')}`,
    );
  }
  return {
    code: applyInsertions(code, insertions),
    editables: inferredFields,
    diagnostics: [...new Set(diagnostics)],
    coverage: {
      visibleSinks: inferredFields.length + ignored + unsupported.length,
      editable: inferredFields.length,
      ignored,
      unsupported,
    },
  };
}
