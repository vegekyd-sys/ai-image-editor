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
}

interface Candidate {
  opening: JSXOpeningElement;
  type: EditableType;
  staticIds: string[];
  propKeyById: Map<string, string>;
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
  propKey: string;
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
  const staleMediaMarker = compilerMarker && mediaTypeFromName(jsxName(opening))
    ? editableAttribute ?? undefined
    : undefined;
  if (editableAttribute && !compilerMarker) return null;
  const componentName = componentFunctionName(path);
  const objectPattern = componentObjectPattern(path);
  if (!componentName || componentName === 'Composition' || !objectPattern) {
    return null;
  }
  const params = objectPatternParamNames(objectPattern);
  const ownMediaType = mediaTypeFromName(jsxName(opening));
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
    opening: ownMediaType ? naturalMediaOwnerOpening(path) : opening,
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
        opening: path.node,
        parentComponentName,
        parentObjectPattern,
      });
      naturalCallsByComponent.set(componentName, calls);
    },
  });

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

    while (queue.length > 0) {
      const state = queue.shift();
      if (!state) break;
      for (const call of naturalCallsByComponent.get(state.componentName) ?? []) {
        const valueExpression = expressionFromAttribute(
          namedAttribute(call.opening, state.valueParam),
        );
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
        const insertion = stringAttributeInsertionFor(
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
      const element = path.node;
      const opening = element.openingElement;
      const name = jsxName(opening);
      if (migratedNaturalOpenings.has(opening)) return;
      if (componentHostOpenings.has(opening)) return;
      const matchingComponentHosts = componentHosts.get(name);
      if (matchingComponentHosts) {
        for (const componentHost of matchingComponentHosts) {
          const candidate = usageCandidate(opening, componentHost, ast, code, props);
          if (candidate) {
            candidates.push(candidate);
          } else {
            diagnostics.push(
              `Editable helper <${name}> must receive ${componentHost.idParam} and ${componentHost.valueParam} from the same top-level props key.`,
            );
          }
        }
        return;
      }
      const explicitAttribute = dataEditableAttribute(opening);
      const explicitStaticId = staticEditableId(explicitAttribute);
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
  return {
    code: applyInsertions(code, insertions),
    editables: inferredFields,
    diagnostics: [...new Set(diagnostics)],
  };
}
