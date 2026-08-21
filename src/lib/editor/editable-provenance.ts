import { parse } from '@babel/parser';
import type {
  ArrowFunctionExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  JSXAttribute,
  JSXElement,
  JSXFragment,
  Node,
  Statement,
} from '@babel/types';
import type { EditableField, EditableType } from '@/types';

type FunctionLike = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
type RenderableNode = Expression | JSXElement | JSXFragment;

export interface ProvenanceOrigin {
  bindingKey: string;
  sourcePath: string;
}

interface ProvenanceValue {
  origins: Map<string, ProvenanceOrigin>;
  strings: Set<string>;
  numbers: Set<number>;
  /** JSX stored in a local alias, for example `const video = <Video src={src} />`. */
  renderables?: RenderableNode[];
  members?: Map<string, ProvenanceValue>;
  items?: ProvenanceValue[];
  unknown?: boolean;
}

export interface EditableProvenanceNode {
  nodeId: string;
  type: EditableType;
  bindingKeys: string[];
  sourcePaths: string[];
  origins: ProvenanceOrigin[];
  component: string;
  line?: number;
  endLine?: number;
  tag: string;
  dynamic: boolean;
  openingStart?: number;
  insertionOffset?: number;
  valueExpression?: string;
  hasExplicitMarker: boolean;
  literalValues?: Record<string, string | number>;
}

export interface EditableProvenanceResult {
  fields: EditableField[];
  nodes: EditableProvenanceNode[];
  diagnostics: string[];
}

export interface EditableProvenanceInput {
  code: string;
  props?: Record<string, unknown>;
  editables?: EditableField[];
}

type Environment = Map<string, ProvenanceValue>;

const EMPTY_VALUE = (): ProvenanceValue => ({
  origins: new Map(),
  strings: new Set(),
  numbers: new Set(),
});

function cloneValue(value: ProvenanceValue): ProvenanceValue {
  return {
    origins: new Map(value.origins),
    strings: new Set(value.strings),
    numbers: new Set(value.numbers),
    ...(value.renderables ? { renderables: [...value.renderables] } : {}),
    ...(value.members ? { members: new Map(value.members) } : {}),
    ...(value.items ? { items: [...value.items] } : {}),
    ...(value.unknown ? { unknown: true } : {}),
  };
}

function mergeValues(values: Array<ProvenanceValue | null | undefined>): ProvenanceValue {
  const result = EMPTY_VALUE();
  const memberValues = new Map<string, ProvenanceValue[]>();
  const itemValues: ProvenanceValue[] = [];
  const renderables: RenderableNode[] = [];
  for (const value of values) {
    if (!value) continue;
    value.origins.forEach((origin, key) => result.origins.set(key, origin));
    value.strings.forEach(value => result.strings.add(value));
    value.numbers.forEach(value => result.numbers.add(value));
    if (value.unknown) result.unknown = true;
    if (value.renderables) renderables.push(...value.renderables);
    value.members?.forEach((member, key) => {
      const existing = memberValues.get(key) ?? [];
      existing.push(member);
      memberValues.set(key, existing);
    });
    if (value.items) itemValues.push(...value.items);
  }
  if (memberValues.size > 0) {
    result.members = new Map(
      [...memberValues].map(([key, members]) => [key, mergeValues(members)]),
    );
  }
  if (itemValues.length > 0) result.items = itemValues;
  if (renderables.length > 0) result.renderables = [...new Set(renderables)];
  return result;
}

function lowerCamel(words: string[]): string {
  return words
    .filter(Boolean)
    .map((word, index) => {
      const normalized = word.replace(/[^A-Za-z0-9_$]/g, '');
      if (!normalized) return '';
      return index === 0
        ? `${normalized[0].toLowerCase()}${normalized.slice(1)}`
        : `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
    })
    .join('');
}

function singular(value: string): string {
  if (/ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1);
  return value;
}

function bindingKeyForPath(path: Array<string | number>): string {
  const words: string[] = [];
  path.forEach((part, index) => {
    if (typeof part === 'number') {
      words.push(String(part + 1));
      return;
    }
    words.push(index === 0 && path.some(item => typeof item === 'number') ? singular(part) : part);
  });
  return lowerCamel(words) || 'editableValue';
}

function sourcePathFor(path: Array<string | number>): string {
  return `props${path.map(part => (
    typeof part === 'number' ? `[${part}]` : `.${part}`
  )).join('')}`;
}

function valueFromConcrete(value: unknown, path: Array<string | number>): ProvenanceValue {
  if (Array.isArray(value)) {
    return {
      ...EMPTY_VALUE(),
      items: value.map((item, index) => valueFromConcrete(item, [...path, index])),
    };
  }
  if (value && typeof value === 'object') {
    return {
      ...EMPTY_VALUE(),
      members: new Map(
        Object.entries(value as Record<string, unknown>)
          .map(([key, child]) => [key, valueFromConcrete(child, [...path, key])]),
      ),
    };
  }
  const result = EMPTY_VALUE();
  const origin: ProvenanceOrigin = {
    bindingKey: bindingKeyForPath(path),
    sourcePath: sourcePathFor(path),
  };
  result.origins.set(origin.sourcePath, origin);
  if (typeof value === 'string') result.strings.add(value);
  if (typeof value === 'number') result.numbers.add(value);
  if (typeof value === 'boolean') result.strings.add(String(value));
  return result;
}

function literalValue(value: unknown): ProvenanceValue {
  const result = EMPTY_VALUE();
  if (typeof value === 'string') result.strings.add(value);
  if (typeof value === 'number') result.numbers.add(value);
  if (typeof value === 'boolean') result.strings.add(String(value));
  return result;
}

function humanize(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced ? `${spaced[0].toUpperCase()}${spaced.slice(1)}` : value;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function jsxName(element: JSXElement): string {
  const name = element.openingElement.name;
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

function attributeByName(element: JSXElement, name: string): JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (attribute): attribute is JSXAttribute => (
      attribute.type === 'JSXAttribute'
      && attribute.name.type === 'JSXIdentifier'
      && attribute.name.name === name
    ),
  );
}

function expressionFromAttribute(attribute: JSXAttribute | undefined): Expression | null {
  if (!attribute?.value) return null;
  if (attribute.value.type === 'StringLiteral') return attribute.value;
  if (
    attribute.value.type === 'JSXExpressionContainer'
    && attribute.value.expression.type !== 'JSXEmptyExpression'
  ) {
    return attribute.value.expression as Expression;
  }
  return null;
}

/**
 * Recover the stable ids from the canonical marker emitted by the provenance
 * compiler. Re-analyzing persisted code must not evaluate the marker call as
 * ordinary JavaScript: its first argument is the rendered value (often a URL),
 * while the second argument is the durable editable-id candidate list.
 */
function compilerEditableMarkerIds(expression: Expression): string[] | null {
  if (expression.type !== 'CallExpression') return null;
  const callee = expression.callee;
  if (
    callee.type !== 'MemberExpression'
    || callee.computed
    || callee.object.type !== 'Identifier'
    || callee.object.name !== 'React'
    || callee.property.type !== 'Identifier'
    || callee.property.name !== '__makaronEditableId'
  ) {
    return null;
  }
  const candidates = expression.arguments[1];
  if (!candidates || candidates.type !== 'ArrayExpression') return null;
  const ids = candidates.elements.flatMap(candidate => {
    if (!candidate || candidate.type !== 'ObjectExpression') return [];
    for (const property of candidate.properties) {
      if (property.type !== 'ObjectProperty' || property.computed) continue;
      const key = property.key.type === 'Identifier'
        ? property.key.name
        : property.key.type === 'StringLiteral'
          ? property.key.value
          : null;
      if (key !== 'id' || property.value.type !== 'StringLiteral') continue;
      return property.value.value ? [property.value.value] : [];
    }
    return [];
  });
  return ids.length > 0 ? [...new Set(ids)] : null;
}

function sourceForNode(code: string, node: Node | null | undefined): string | null {
  if (!node || node.start == null || node.end == null) return null;
  return code.slice(node.start, node.end);
}

function isIgnored(element: JSXElement): boolean {
  return Boolean(attributeByName(element, 'data-editable-ignore'));
}

function mediaType(name: string): Extract<EditableType, 'image' | 'video'> | null {
  if (['Img', 'img'].includes(name)) return 'image';
  if (['Video', 'video', 'OffthreadVideo'].includes(name)) return 'video';
  return null;
}

function cloneEnvironment(environment: Environment): Environment {
  return new Map([...environment].map(([key, value]) => [key, cloneValue(value)]));
}

function bindPattern(
  pattern: Node | null | undefined,
  value: ProvenanceValue,
  environment: Environment,
) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    environment.set(pattern.name, value);
    return;
  }
  if (pattern.type === 'AssignmentPattern') {
    bindPattern(pattern.left, value, environment);
    return;
  }
  if (pattern.type === 'RestElement') {
    bindPattern(pattern.argument, value, environment);
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    pattern.properties.forEach(property => {
      if (property.type === 'RestElement') {
        bindPattern(property.argument, value, environment);
        return;
      }
      const key = property.computed
        ? null
        : property.key.type === 'Identifier'
          ? property.key.name
          : property.key.type === 'StringLiteral'
            ? property.key.value
            : null;
      bindPattern(
        property.value,
        key ? value.members?.get(key) ?? EMPTY_VALUE() : mergeValues(value.members ? [...value.members.values()] : []),
        environment,
      );
    });
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    pattern.elements.forEach((element, index) => {
      if (element) bindPattern(element, value.items?.[index] ?? EMPTY_VALUE(), environment);
    });
  }
}

class ProvenanceAnalyzer {
  private readonly functions = new Map<string, FunctionLike>();
  private readonly globalInitializers = new Map<string, Expression>();
  private readonly globalValues = new Map<string, ProvenanceValue>();
  private readonly resolvingGlobals = new Set<string>();
  private readonly fields = new Map<string, EditableField>();
  private readonly nodes = new Map<string, EditableProvenanceNode>();
  private readonly diagnostics: string[] = [];
  private readonly activeCalls = new Set<string>();

  constructor(
    private readonly code: string,
    private readonly props: Record<string, unknown>,
    editables: EditableField[] | undefined,
  ) {
    editables?.forEach(field => this.fields.set(field.propKey, field));
  }

  analyze(): EditableProvenanceResult {
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(this.code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
      });
    } catch (error) {
      return {
        fields: [...this.fields.values()],
        nodes: [],
        diagnostics: [
          `Editable provenance parse failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    ast.program.body.forEach(programStatement => {
      const statement = (
        programStatement.type === 'ExportNamedDeclaration'
        || programStatement.type === 'ExportDefaultDeclaration'
      ) && programStatement.declaration
        ? programStatement.declaration
        : programStatement;
      if (statement.type === 'FunctionDeclaration' && statement.id) {
        this.functions.set(statement.id.name, statement);
        return;
      }
      if (statement.type !== 'VariableDeclaration') return;
      statement.declarations.forEach(declaration => {
        if (declaration.id.type !== 'Identifier' || !declaration.init) return;
        if (
          declaration.init.type === 'ArrowFunctionExpression'
          || declaration.init.type === 'FunctionExpression'
        ) {
          this.functions.set(declaration.id.name, declaration.init);
        } else {
          this.globalInitializers.set(declaration.id.name, declaration.init as Expression);
        }
      });
    });

    const rootName = [
      'Composition',
      'Design',
      'AgentDesign',
      'DevLog',
      'App',
      'Main',
      'Scene',
    ].find(name => this.functions.has(name));
    const fallbackName = [...this.functions.keys()].reverse().find(name => /^[A-Z]/.test(name));
    const entryName = rootName ?? fallbackName;
    if (!entryName) {
      this.diagnostics.push('Editable provenance could not find a composition entry component.');
      return this.result();
    }

    const propMembers = new Map<string, ProvenanceValue>();
    Object.entries(this.props).forEach(([key, value]) => {
      propMembers.set(key, valueFromConcrete(value, [key]));
    });
    this.processFunction(entryName, {
      ...EMPTY_VALUE(),
      members: propMembers,
    }, `root:${entryName}`);
    return this.result();
  }

  private result(): EditableProvenanceResult {
    return {
      fields: [...this.fields.values()],
      nodes: [...this.nodes.values()],
      diagnostics: [...new Set(this.diagnostics)],
    };
  }

  private resolveIdentifier(name: string, environment: Environment): ProvenanceValue {
    const local = environment.get(name);
    if (local) return local;
    const cached = this.globalValues.get(name);
    if (cached) return cached;
    const initializer = this.globalInitializers.get(name);
    if (!initializer || this.resolvingGlobals.has(name)) return EMPTY_VALUE();
    this.resolvingGlobals.add(name);
    const value = this.evaluate(initializer, new Map());
    this.resolvingGlobals.delete(name);
    this.globalValues.set(name, value);
    return value;
  }

  private evaluate(node: Node | null | undefined, environment: Environment): ProvenanceValue {
    if (!node) return EMPTY_VALUE();
    switch (node.type) {
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
        return literalValue(node.value);
      case 'NullLiteral':
        return EMPTY_VALUE();
      case 'JSXElement':
      case 'JSXFragment':
        return { ...EMPTY_VALUE(), renderables: [node] };
      case 'TemplateLiteral':
        return mergeValues([
          ...node.quasis.map(quasi => literalValue(quasi.value.cooked ?? quasi.value.raw)),
          ...node.expressions.map(expression => this.evaluate(expression, environment)),
        ]);
      case 'Identifier':
        return this.resolveIdentifier(node.name, environment);
      case 'ObjectExpression': {
        const members = new Map<string, ProvenanceValue>();
        node.properties.forEach(property => {
          if (property.type === 'SpreadElement') {
            const spread = this.evaluate(property.argument, environment);
            spread.members?.forEach((value, key) => members.set(key, value));
            return;
          }
          if (property.type !== 'ObjectProperty') return;
          const keyValue = property.computed
            ? this.evaluate(property.key, environment)
            : null;
          const keys = keyValue
            ? [...keyValue.strings, ...[...keyValue.numbers].map(String)]
            : property.key.type === 'Identifier'
              ? [property.key.name]
              : property.key.type === 'StringLiteral' || property.key.type === 'NumericLiteral'
                ? [String(property.key.value)]
                : [];
          const value = this.evaluate(property.value, environment);
          keys.forEach(key => members.set(key, value));
        });
        return { ...EMPTY_VALUE(), members };
      }
      case 'ArrayExpression':
        return {
          ...EMPTY_VALUE(),
          items: node.elements.map(element => (
            element && element.type !== 'SpreadElement'
              ? this.evaluate(element, environment)
              : element?.type === 'SpreadElement'
                ? this.evaluate(element.argument, environment)
                : EMPTY_VALUE()
          )).flatMap(value => value.items ?? [value]),
        };
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return this.evaluateMember(node, environment);
      case 'LogicalExpression':
      case 'BinaryExpression':
        return mergeValues([
          this.evaluate(node.left, environment),
          this.evaluate(node.right, environment),
        ]);
      case 'ConditionalExpression':
        return mergeValues([
          this.evaluate(node.consequent, environment),
          this.evaluate(node.alternate, environment),
        ]);
      case 'UnaryExpression':
      case 'UpdateExpression':
        return this.evaluate(node.argument, environment);
      case 'SequenceExpression':
        return mergeValues(node.expressions.map(expression => this.evaluate(expression, environment)));
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.evaluateCall(node, environment);
      case 'TSAsExpression':
      case 'TSTypeAssertion':
      case 'TSNonNullExpression':
        return this.evaluate(node.expression, environment);
      case 'ParenthesizedExpression':
        return this.evaluate(node.expression, environment);
      case 'AssignmentExpression':
        return this.evaluate(node.right, environment);
      default:
        return EMPTY_VALUE();
    }
  }

  private evaluateMember(
    node: Extract<Node, { type: 'MemberExpression' | 'OptionalMemberExpression' }>,
    environment: Environment,
  ): ProvenanceValue {
    const object = this.evaluate(node.object, environment);
    const keys = node.computed
      ? (() => {
          const property = this.evaluate(node.property, environment);
          return [...property.strings, ...[...property.numbers].map(String)];
        })()
      : node.property.type === 'Identifier'
        ? [node.property.name]
        : [];
    if (keys.includes('length')) return literalValue(object.items?.length ?? object.strings.size);
    const candidates: ProvenanceValue[] = [];
    if (object.members) {
      if (keys.length > 0) {
        keys.forEach(key => {
          const candidate = object.members?.get(key);
          if (candidate) candidates.push(candidate);
        });
      } else {
        candidates.push(...object.members.values());
      }
    }
    if (object.items) {
      const indices = keys
        .map(key => Number(key))
        .filter(index => Number.isInteger(index));
      if (indices.length > 0) {
        indices.forEach(index => {
          const candidate = object.items?.[index];
          if (candidate) candidates.push(candidate);
        });
      } else if (node.computed) {
        candidates.push(...object.items);
      }
    }
    return mergeValues(candidates);
  }

  private evaluateCall(
    node: Extract<Node, { type: 'CallExpression' | 'OptionalCallExpression' }>,
    environment: Environment,
  ): ProvenanceValue {
    const args = node.arguments.map(argument => (
      argument.type === 'SpreadElement'
        ? this.evaluate(argument.argument, environment)
        : this.evaluate(argument, environment)
    ));
    if (node.callee.type === 'Identifier') {
      if (['String', 'Number', 'Boolean'].includes(node.callee.name)) {
        return mergeValues(args);
      }
      if (this.functions.has(node.callee.name)) {
        return this.evaluateFunctionReturn(node.callee.name, args, environment);
      }
      return mergeValues(args);
    }
    if (
      node.callee.type === 'MemberExpression'
      || node.callee.type === 'OptionalMemberExpression'
    ) {
      const receiver = this.evaluate(node.callee.object, environment);
      const method = !node.callee.computed && node.callee.property.type === 'Identifier'
        ? node.callee.property.name
        : null;
      if (method === 'find' || method === 'at') {
        if (!receiver.items) return mergeValues([receiver, ...args]);
        if (method === 'at' && args[0]?.numbers.size === 1) {
          const index = [...args[0].numbers][0];
          return receiver.items[index] ?? EMPTY_VALUE();
        }
        return mergeValues(receiver.items);
      }
      if (method === 'filter') return receiver;
      if (method === 'split') {
        const separator = args[0]?.strings.size === 1
          ? [...args[0].strings][0]
          : undefined;
        const concrete = receiver.strings.size === 1
          ? [...receiver.strings][0]
          : null;
        if (concrete == null) return receiver;
        return {
          ...cloneValue(receiver),
          items: (separator === undefined ? [concrete] : concrete.split(separator)).map(part => ({
            ...cloneValue(receiver),
            strings: new Set([part]),
            numbers: new Set(),
          })),
        };
      }
      if ([
        'replace',
        'replaceAll',
        'toUpperCase',
        'toLowerCase',
        'trim',
        'trimStart',
        'trimEnd',
        'slice',
        'substring',
        'substr',
        'padStart',
        'padEnd',
      ].includes(method ?? '')) {
        // These operations transform the receiver's presentation. Their
        // pattern, replacement, width, and padding arguments are not content
        // sources for the rendered value.
        return receiver;
      }
      if (method === 'map') {
        const callback = node.arguments[0];
        if (
          callback
          && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')
        ) {
          const items = receiver.items ?? [mergeValues(receiver.items ?? [])];
          return {
            ...cloneValue(receiver),
            items: items.map((item, index) => this.evaluateInlineFunction(
              callback,
              [item, literalValue(index)],
              environment,
            )),
          };
        }
      }
      return mergeValues([receiver, ...args]);
    }
    return mergeValues(args);
  }

  private evaluateInlineFunction(
    fn: FunctionExpression | ArrowFunctionExpression,
    args: ProvenanceValue[],
    parentEnvironment: Environment,
  ): ProvenanceValue {
    const environment = cloneEnvironment(parentEnvironment);
    fn.params.forEach((param, index) => bindPattern(param, args[index] ?? EMPTY_VALUE(), environment));
    if (fn.body.type !== 'BlockStatement') return this.evaluate(fn.body, environment);
    const values: ProvenanceValue[] = [];
    this.walkStatements(fn.body.body, environment, (_node, local) => {
      values.push(this.evaluate(_node, local));
    });
    return mergeValues(values);
  }

  private evaluateFunctionReturn(
    name: string,
    args: ProvenanceValue[],
    parentEnvironment: Environment,
  ): ProvenanceValue {
    const fn = this.functions.get(name);
    if (!fn || this.activeCalls.has(`value:${name}`)) return mergeValues(args);
    this.activeCalls.add(`value:${name}`);
    const environment = cloneEnvironment(parentEnvironment);
    fn.params.forEach((param, index) => bindPattern(param, args[index] ?? EMPTY_VALUE(), environment));
    const values: ProvenanceValue[] = [];
    if (fn.body.type === 'BlockStatement') {
      this.walkStatements(fn.body.body, environment, (node, local) => {
        values.push(this.evaluate(node, local));
      });
    } else {
      values.push(this.evaluate(fn.body, environment));
    }
    this.activeCalls.delete(`value:${name}`);
    return mergeValues(values);
  }

  private processFunction(name: string, propsValue: ProvenanceValue, context: string) {
    const fn = this.functions.get(name);
    if (!fn) return;
    const callKey = `render:${name}:${context}`;
    if (this.activeCalls.has(callKey)) return;
    this.activeCalls.add(callKey);
    const environment: Environment = new Map();
    if (fn.params[0]) bindPattern(fn.params[0], propsValue, environment);
    if (fn.body.type === 'BlockStatement') {
      this.walkStatements(fn.body.body, environment, (node, local) => {
        this.processRenderable(node, local, name, context);
      });
    } else {
      this.processRenderable(fn.body, environment, name, context);
    }
    this.activeCalls.delete(callKey);
  }

  private walkStatements(
    statements: Statement[],
    environment: Environment,
    onReturn: (node: RenderableNode, environment: Environment) => void,
  ) {
    for (const statement of statements) {
      if (statement.type === 'VariableDeclaration') {
        statement.declarations.forEach(declaration => {
          const value = declaration.init
            ? this.evaluate(declaration.init, environment)
            : EMPTY_VALUE();
          bindPattern(declaration.id, value, environment);
        });
        continue;
      }
      if (statement.type === 'ReturnStatement' && statement.argument) {
        onReturn(statement.argument as RenderableNode, cloneEnvironment(environment));
        continue;
      }
      if (statement.type === 'IfStatement') {
        const consequent = statement.consequent.type === 'BlockStatement'
          ? statement.consequent.body
          : [statement.consequent];
        this.walkStatements(consequent, cloneEnvironment(environment), onReturn);
        if (statement.alternate) {
          const alternate = statement.alternate.type === 'BlockStatement'
            ? statement.alternate.body
            : [statement.alternate];
          this.walkStatements(alternate, cloneEnvironment(environment), onReturn);
        }
        continue;
      }
      if (statement.type === 'BlockStatement') {
        this.walkStatements(statement.body, cloneEnvironment(environment), onReturn);
      }
    }
  }

  private processRenderable(
    node: Node | null | undefined,
    environment: Environment,
    component: string,
    context: string,
  ) {
    if (!node) return;
    if (node.type === 'JSXElement') {
      this.processElement(node, environment, component, context);
      return;
    }
    if (node.type === 'JSXFragment') {
      node.children.forEach(child => {
        if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
          this.processRenderable(child, environment, component, context);
        } else if (
          child.type === 'JSXExpressionContainer'
          && child.expression.type !== 'JSXEmptyExpression'
        ) {
          this.processRenderable(child.expression, environment, component, context);
        }
      });
      return;
    }
    if (node.type === 'ConditionalExpression') {
      this.processRenderable(node.consequent, environment, component, `${context}:then`);
      this.processRenderable(node.alternate, environment, component, `${context}:else`);
      return;
    }
    if (node.type === 'LogicalExpression') {
      this.processRenderable(node.right, environment, component, `${context}:logical`);
      return;
    }
    if (node.type === 'ArrayExpression') {
      node.elements.forEach((element, index) => {
        if (element && element.type !== 'SpreadElement') {
          this.processRenderable(element, environment, component, `${context}:array${index}`);
        }
      });
      return;
    }
    if (
      (node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
      && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')
      && !node.callee.computed
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === 'map'
    ) {
      const collection = this.evaluate(node.callee.object, environment);
      const callback = node.arguments[0];
      if (
        callback
        && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')
      ) {
        const items = collection.items?.length
          ? collection.items
          : [mergeValues(collection.items ?? [])];
        items.forEach((item, index) => {
          const local = cloneEnvironment(environment);
          callback.params.forEach((param, paramIndex) => bindPattern(
            param,
            paramIndex === 0 ? item : literalValue(index),
            local,
          ));
          const nextContext = `${context}:map${node.start ?? 'x'}:${index}`;
          if (callback.body.type === 'BlockStatement') {
            this.walkStatements(callback.body.body, local, (returned, returnedEnvironment) => {
              this.processRenderable(returned, returnedEnvironment, component, nextContext);
            });
          } else {
            this.processRenderable(callback.body, local, component, nextContext);
          }
        });
      }
      return;
    }

    // React authors commonly assign JSX to a local variable before wrapping or
    // conditionally returning it. Preserve that renderable identity so media
    // provenance is not lost merely because `<Video>` is one alias away.
    const aliased = this.evaluate(node, environment).renderables ?? [];
    aliased.forEach(renderable => {
      if (renderable !== node) {
        this.processRenderable(renderable, environment, component, `${context}:alias`);
      }
    });
  }

  private expressionRendersElements(node: Node): boolean {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
    if (node.type === 'ConditionalExpression') {
      return this.expressionRendersElements(node.consequent)
        || this.expressionRendersElements(node.alternate);
    }
    if (node.type === 'LogicalExpression') return this.expressionRendersElements(node.right);
    if (
      node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && !node.callee.computed
      && node.callee.property.type === 'Identifier'
      && node.callee.property.name === 'map'
    ) {
      const callback = node.arguments[0];
      if (
        callback?.type === 'ArrowFunctionExpression'
        || callback?.type === 'FunctionExpression'
      ) {
        if (callback.body.type !== 'BlockStatement') return this.expressionRendersElements(callback.body);
        return callback.body.body.some(statement => (
          statement.type === 'ReturnStatement'
          && Boolean(statement.argument)
          && this.expressionRendersElements(statement.argument as Node)
        ));
      }
    }
    return false;
  }

  private processElement(
    element: JSXElement,
    environment: Environment,
    component: string,
    context: string,
  ) {
    if (isIgnored(element)) return;
    const name = jsxName(element);
    const callSite = element.start ?? element.loc?.start.line ?? name;
    if (/^[A-Z]/.test(name) && this.functions.has(name)) {
      const members = new Map<string, ProvenanceValue>();
      element.openingElement.attributes.forEach(attribute => {
        if (attribute.type === 'JSXSpreadAttribute') {
          const spread = this.evaluate(attribute.argument, environment);
          spread.members?.forEach((value, key) => members.set(key, value));
          return;
        }
        if (attribute.name.type !== 'JSXIdentifier') return;
        const value = attribute.value == null
          ? literalValue(true)
          : attribute.value.type === 'StringLiteral'
            ? literalValue(attribute.value.value)
            : attribute.value.type === 'JSXExpressionContainer'
              && attribute.value.expression.type !== 'JSXEmptyExpression'
              ? this.evaluate(attribute.value.expression, environment)
              : EMPTY_VALUE();
        members.set(attribute.name.name, value);
      });
      const childValues = element.children.flatMap(child => {
        if (child.type === 'JSXText' && child.value.trim()) return [literalValue(child.value.trim())];
        if (
          child.type === 'JSXExpressionContainer'
          && child.expression.type !== 'JSXEmptyExpression'
          && !this.expressionRendersElements(child.expression)
        ) {
          return [this.evaluate(child.expression, environment)];
        }
        return [];
      });
      if (childValues.length > 0) members.set('children', mergeValues(childValues));
      this.processFunction(name, { ...EMPTY_VALUE(), members }, `${context}:call${callSite}`);
      return;
    }

    const ownMediaType = mediaType(name);
    if (ownMediaType) {
      const source = this.preferExplicitBinding(element, environment, this.evaluate(
        expressionFromAttribute(attributeByName(element, 'src')),
        environment,
      ));
      this.registerNode(element, name, ownMediaType, source, component, context, environment);
    }

    let ownsAggregateRenderedText = false;
    if (/^[a-z]/.test(name)) {
      const textValues: ProvenanceValue[] = [];
      let hasLiteralText = false;
      let hasValueExpression = false;
      element.children.forEach(child => {
        if (child.type === 'JSXText' && child.value.trim()) {
          textValues.push(literalValue(child.value.replace(/\s+/g, ' ').trim()));
          hasLiteralText = true;
          return;
        }
        if (
          child.type === 'JSXExpressionContainer'
          && child.expression.type !== 'JSXEmptyExpression'
        ) {
          if (!this.expressionRendersElements(child.expression)) {
            hasValueExpression = true;
            textValues.push(this.evaluate(child.expression, environment));
          }
        }
      });
      if (textValues.length > 0) {
        const text = this.preferExplicitBinding(
          element,
          environment,
          mergeValues(textValues),
        );
        const canLiftLiteral = (
          (!hasValueExpression && hasLiteralText)
          || (hasValueExpression && !hasLiteralText && text.strings.size > 0)
        );
        if (text.origins.size === 0 && canLiftLiteral) {
          const literalOrigins = [...text.strings]
            .filter(Boolean)
            .map((value, index) => {
              const sourcePath = `literal:${component}:${element.start ?? element.loc?.start.line ?? name}:${context}:${index}`;
              return {
                bindingKey: `literal${element.loc?.start.line ?? 0}_${hashText(`${sourcePath}:${value}`)}`,
                sourcePath,
              };
            });
          literalOrigins.forEach(origin => text.origins.set(origin.sourcePath, origin));
        }
        if (text.origins.size > 0) {
          this.registerNode(element, name, 'text', text, component, context, environment);
        }
      }

      // Styled captions commonly render one sentence through split().map()
      // word spans. The sentence is the user-owned value; the spans are only
      // its presentation. Aggregate a single proven source on the measurable
      // parent so editing remains one field per sentence, not one id per word.
      const renderedExpressions = element.children.flatMap(child => {
        if (
          child.type !== 'JSXExpressionContainer'
          || child.expression.type === 'JSXEmptyExpression'
          || !this.expressionRendersElements(child.expression)
        ) {
          return [];
        }
        return [{
          expression: child.expression,
          value: this.evaluate(child.expression, environment),
        }];
      });
      if (
        textValues.length === 0
        && renderedExpressions.length === 1
        && renderedExpressions[0].value.origins.size === 1
      ) {
        const expression = sourceForNode(this.code, renderedExpressions[0].expression);
        this.registerNode(
          element,
          name,
          'text',
          renderedExpressions[0].value,
          component,
          context,
          environment,
          expression ?? undefined,
        );
        ownsAggregateRenderedText = true;
      }
    }

    // An authored marker owns its complete measurable subtree. Do not add a
    // second provenance marker to a nested text/media leaf: doing so would
    // silently bypass the existing wrapper-size validation and could move or
    // scale a different box than the author selected.
    if (attributeByName(element, 'data-editable')) return;
    if (ownsAggregateRenderedText) return;

    element.children.forEach(child => {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
        this.processRenderable(child, environment, component, context);
      } else if (
        child.type === 'JSXExpressionContainer'
        && child.expression.type !== 'JSXEmptyExpression'
        && (
          this.expressionRendersElements(child.expression)
          || (this.evaluate(child.expression, environment).renderables?.length ?? 0) > 0
        )
      ) {
        // Remotion structural components such as AbsoluteFill and Sequence are
        // runtime scope values rather than locally declared functions. Their
        // renderable expression children still belong to the reachable graph.
        this.processRenderable(child.expression, environment, component, context);
      }
    });
  }

  private registerNode(
    element: JSXElement,
    tag: string,
    type: EditableType,
    value: ProvenanceValue,
    component: string,
    context: string,
    environment: Environment,
    valueExpressionOverride?: string,
  ) {
    const origins = [...value.origins.values()];
    if (origins.length === 0) return;
    origins.forEach(origin => {
      const existing = this.fields.get(origin.bindingKey);
      if (!existing) {
        this.fields.set(origin.bindingKey, {
          id: origin.bindingKey,
          type,
          label: humanize(origin.bindingKey),
          propKey: origin.bindingKey,
          ...(origin.sourcePath.startsWith('literal:') ? { source: 'literal' as const } : {}),
        });
      } else if (existing.type !== type) {
        this.diagnostics.push(
          `Binding ${origin.bindingKey} reaches both ${existing.type} and ${type} sinks.`,
        );
      }
    });
    // The same aliased JSX node can be reachable through both sides of a
    // conditional (`loop ? <Loop>{video}</Loop> : video`). Branch labels are
    // traversal details, not separate runtime hosts. Keep call/map identity but
    // collapse duplicate visits to the same authored element.
    const stableContext = context.replace(/:(?:then|else|logical|alias)\b/g, '');
    const site = `${component}:${element.start ?? element.loc?.start.line ?? tag}:${stableContext}`;
    const explicit = expressionFromAttribute(attributeByName(element, 'data-editable'));
    const explicitValue = explicit ? this.evaluate(explicit, environment) : EMPTY_VALUE();
    const compilerMarkerIds = explicit ? compilerEditableMarkerIds(explicit) : null;
    const explicitId = compilerMarkerIds?.length === 1
      ? compilerMarkerIds[0]
      : explicitValue.strings.size === 1
        ? [...explicitValue.strings][0]
        : null;
    const nodeId = explicitId ?? `node_${hashText(site)}`;
    const existingNode = this.nodes.get(nodeId);
    const bindingKeys = [...new Set([
      ...(existingNode?.bindingKeys ?? []),
      ...origins.map(origin => origin.bindingKey),
    ])].sort();
    const sourcePaths = [...new Set([
      ...(existingNode?.sourcePaths ?? []),
      ...origins.map(origin => origin.sourcePath),
    ])].sort();
    const mergedOrigins = [...new Map([
      ...(existingNode?.origins ?? []),
      ...origins,
    ].map(origin => [origin.sourcePath, origin])).values()]
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    const literalValues = { ...(existingNode?.literalValues ?? {}) };
    if (value.strings.size === 1) {
      const literalValue = [...value.strings][0];
      origins
        .filter(origin => origin.sourcePath.startsWith('literal:'))
        .forEach(origin => { literalValues[origin.bindingKey] = literalValue; });
    } else if (value.numbers.size === 1) {
      const literalValue = [...value.numbers][0];
      origins
        .filter(origin => origin.sourcePath.startsWith('literal:'))
        .forEach(origin => { literalValues[origin.bindingKey] = literalValue; });
    }
    const opening = element.openingElement;
    const insertionOffset = opening.end == null
      ? undefined
      : opening.end - (opening.selfClosing ? 2 : 1);
    const valueExpression = valueExpressionOverride ?? (type === 'text'
      ? (() => {
          const expressions = element.children.flatMap(child => {
            if (
              child.type === 'JSXExpressionContainer'
              && child.expression.type !== 'JSXEmptyExpression'
              && !this.expressionRendersElements(child.expression)
            ) {
              const expression = sourceForNode(this.code, child.expression);
              return expression ? [expression] : [];
            }
            return [];
          });
          if (expressions.length === 1) return expressions[0];
          if (expressions.length > 1) return undefined;
          if (value.strings.size === 1) return JSON.stringify([...value.strings][0]);
          return undefined;
        })()
      : sourceForNode(
          this.code,
          expressionFromAttribute(attributeByName(element, 'src')),
        ) ?? undefined);
    this.nodes.set(nodeId, {
      nodeId,
      type,
      bindingKeys,
      sourcePaths,
      origins: mergedOrigins,
      component,
      ...(element.loc?.start.line ? { line: element.loc.start.line } : {}),
      ...(element.loc?.end.line ? { endLine: element.loc.end.line } : {}),
      tag,
      dynamic: bindingKeys.length > 1,
      ...(opening.start != null ? { openingStart: opening.start } : {}),
      ...(insertionOffset != null ? { insertionOffset } : {}),
      ...(valueExpression ? { valueExpression } : {}),
      hasExplicitMarker: Boolean(attributeByName(element, 'data-editable')),
      ...(Object.keys(literalValues).length > 0 ? { literalValues } : {}),
    });
  }

  /**
   * Normalized legacy compositions already carry the compiler's canonical
   * runtime marker. When it resolves to a stable id, that binding is more
   * authoritative than the rendered literal or an upstream alias: the marker
   * is exactly what Preview/export overrides consume. Unmarked nodes continue
   * through provenance tracing.
   */
  private preferExplicitBinding(
    element: JSXElement,
    environment: Environment,
    inferred: ProvenanceValue,
  ): ProvenanceValue {
    const attribute = attributeByName(element, 'data-editable');
    const expression = expressionFromAttribute(attribute);
    if (!attribute || !expression) return inferred;
    const compilerMarkerIds = compilerEditableMarkerIds(expression);
    const marker = compilerMarkerIds ? null : this.evaluate(expression, environment);
    const ids = compilerMarkerIds ?? [...(marker?.strings ?? [])].filter(Boolean);
    if (ids.length === 0) return inferred;
    const explicit = EMPTY_VALUE();
    ids.forEach(id => {
      const existing = [...this.fields.values()].find(field => (
        field.id === id || field.propKey === id
      ));
      const bindingKey = existing?.propKey ?? id;
      const sourcePath = existing?.source === 'literal'
        ? `manifest:${existing.id}`
        : Object.prototype.hasOwnProperty.call(this.props, bindingKey)
          ? `props.${bindingKey}`
          : `marker:${id}`;
      explicit.origins.set(sourcePath, { bindingKey, sourcePath });
    });
    return explicit;
  }
}

export function analyzeEditableProvenance({
  code,
  props = {},
  editables,
}: EditableProvenanceInput): EditableProvenanceResult {
  return new ProvenanceAnalyzer(code, props, editables).analyze();
}
