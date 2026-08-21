import type React from 'react';
import { editableRuntimeClassName } from './scene-registry';

export type EditableTransformMode = 'proxy' | 'registry';

export const REMOTION_EDITABLE_RUNTIME_VERSION =
  'remotion-editable-runtime-r2-media-ownership';

type ReactRuntime = typeof React;

export interface EditableReactRuntime {
  React: ReactRuntime;
  wrap: (
    Component: React.ComponentType<any>,
    transformMode: EditableTransformMode,
  ) => React.ComponentType<any>;
}

function normalizedEditableValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  return value
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function editableValuesMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const normalizedLeft = normalizedEditableValue(left);
  const normalizedRight = normalizedEditableValue(right);
  return normalizedLeft != null
    && normalizedRight != null
    && normalizedLeft === normalizedRight;
}

interface EditableIdCandidate {
  id: string;
  paths?: readonly string[];
}

function readEditableSourcePath(
  props: Record<string, unknown>,
  sourcePath: string,
): unknown {
  if (!sourcePath.startsWith('props')) return undefined;
  const suffix = sourcePath.slice('props'.length);
  const tokenPattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g;
  let consumed = 0;
  let value: unknown = props;
  for (const match of suffix.matchAll(tokenPattern)) {
    if (match.index !== consumed) return undefined;
    if (value == null || typeof value !== 'object') return undefined;
    const key = match[1] ?? Number(match[2]);
    value = (value as Record<string | number, unknown>)[key];
    consumed = (match.index ?? 0) + match[0].length;
  }
  return consumed === suffix.length ? value : undefined;
}

const RENDERED_LINE_BREAK_RE = /(\\r\\n|\\n|\\r|\r\n|\n|\r)/g;

/**
 * Agent-authored copy frequently crosses JSON, tool-call, and JSX boundaries.
 * A requested line break can therefore arrive at the final React host as the
 * two visible characters `\\n` instead of a real newline. React also collapses
 * real newlines under normal white-space rules. Turn both forms into explicit
 * <br> nodes at the shared Preview/export boundary so every composition gets
 * the same deterministic rendering without depending on per-template CSS.
 */
export function renderTextLineBreaks(
  react: ReactRuntime,
  value: React.ReactNode,
): React.ReactNode {
  if (typeof value !== 'string' || !RENDERED_LINE_BREAK_RE.test(value)) {
    RENDERED_LINE_BREAK_RE.lastIndex = 0;
    return value;
  }

  RENDERED_LINE_BREAK_RE.lastIndex = 0;
  const parts = value.split(RENDERED_LINE_BREAK_RE);
  const rendered: React.ReactNode[] = [];
  let breakIndex = 0;
  for (const part of parts) {
    if (!part) continue;
    if (/^(?:\\r\\n|\\n|\\r|\r\n|\n|\r)$/.test(part)) {
      rendered.push(react.createElement('br', { key: `makaron-line-break-${breakIndex++}` }));
    } else {
      rendered.push(part);
    }
  }
  return rendered;
}

export function createEditableReactRuntime(
  react: ReactRuntime,
  videoComponent: React.ElementType,
): EditableReactRuntime {
  let currentProps: Record<string, unknown> = {};
  let currentTransformMode: EditableTransformMode = 'proxy';
  const originalCreateElement = react.createElement;

  const resolveEditableId = (
    renderedValue: unknown,
    candidates: readonly (string | EditableIdCandidate)[],
  ): string | undefined => {
    const normalizedCandidates = candidates.map(candidate => (
      typeof candidate === 'string' ? { id: candidate } : candidate
    ));
    const candidateIds = normalizedCandidates.map(candidate => candidate.id);
    if (candidateIds.length === 1) return candidateIds[0];
    const candidateValues = (candidate: EditableIdCandidate): unknown[] => [
      currentProps[candidate.id],
      ...(candidate.paths ?? []).map(path => readEditableSourcePath(currentProps, path)),
    ];
    const exactMatches = normalizedCandidates.filter(candidate => (
      candidateValues(candidate).some(value => Object.is(value, renderedValue))
    ));
    if (exactMatches.length === 1) return exactMatches[0].id;

    const normalizedRendered = normalizedEditableValue(renderedValue);
    if (normalizedRendered == null) return undefined;
    const normalizedMatches = normalizedCandidates.filter(candidate => (
      candidateValues(candidate).some(value => (
        normalizedEditableValue(value) === normalizedRendered
      ))
    ));
    if (normalizedMatches.length === 1) return normalizedMatches[0].id;

    if (typeof normalizedRendered !== 'string') return undefined;
    const caseFolded = normalizedRendered.toLocaleLowerCase();
    const caseInsensitiveMatches = normalizedCandidates.filter(candidate => {
      return candidateValues(candidate).some(value => {
        const normalized = normalizedEditableValue(value);
        return typeof normalized === 'string'
          && normalized.toLocaleLowerCase() === caseFolded;
      });
    });
    if (caseInsensitiveMatches.length === 1) return caseInsensitiveMatches[0].id;

    const containedMatches = normalizedCandidates.filter(candidate => (
      candidateValues(candidate).some(value => {
        const normalized = normalizedEditableValue(value);
        return typeof normalized === 'string'
          && normalized.length > 0
          && caseFolded.includes(normalized.toLocaleLowerCase());
      })
    ));
    return containedMatches.length === 1 ? containedMatches[0].id : undefined;
  };

  const readFrameProp = (key: string): number | undefined => {
    const value = currentProps[key];
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
  };

  const injectLegacyVideoTrim = (
    node: React.ReactNode,
    trim: { trimBefore?: number; trimAfter?: number },
  ): React.ReactNode => {
    if (!react.isValidElement(node)) return node;

    if (node.type === videoComponent) {
      return react.cloneElement(node, {
        ...(trim.trimBefore !== undefined ? { trimBefore: trim.trimBefore } : {}),
        ...(trim.trimAfter !== undefined ? { trimAfter: trim.trimAfter } : {}),
      });
    }

    const props = node.props as { children?: React.ReactNode };
    if (!props.children) return node;

    return react.cloneElement(
      node,
      undefined,
      react.Children.map(
        props.children,
        child => injectLegacyVideoTrim(child, trim),
      ),
    );
  };

  const hasSameIdEditableDescendant = (
    children: React.ReactNode[],
    id: string,
  ): boolean => children.some(child => {
    if (!react.isValidElement(child)) return false;
    const childProps = child.props as {
      children?: React.ReactNode;
      id?: unknown;
      editableId?: unknown;
      'data-editable'?: unknown;
    };
    if (childProps['data-editable'] === id) return true;
    if (
      typeof child.type !== 'string'
      && Object.entries(childProps).some(([key, value]) =>
        value === id && (key === 'id' || key === 'editableId' || key.endsWith('Id'))
      )
    ) {
      return true;
    }
    return hasSameIdEditableDescendant(
      react.Children.toArray(childProps.children),
      id,
    );
  });

  const patchedCreateElement = function(
    type: React.ElementType,
    elementProps: Record<string, unknown> | null,
    ...children: React.ReactNode[]
  ) {
    let nextProps = elementProps;
    let nextChildren = children;
    if (nextProps && typeof nextProps['data-editable'] === 'string') {
      const id = nextProps['data-editable'];
      const hasProvenanceValue = Object.prototype.hasOwnProperty.call(
        nextProps,
        'data-editable-provenance',
      );
      const provenanceValue = nextProps['data-editable-provenance'];
      if (hasProvenanceValue) {
        const { 'data-editable-provenance': _provenanceValue, ...rest } = nextProps;
        void _provenanceValue;
        nextProps = rest;
      }
      const renderedChildren = nextChildren.length > 0
        ? nextChildren
        : react.Children.toArray(nextProps.children as React.ReactNode);
      const textOverride = currentProps[id];
      // A static marker on a reusable media helper can otherwise claim every
      // <Video>/<Img> instance and replace all sources with one prop. Compiler
      // markers carry provenance and are safe; legacy static markers only own
      // a direct media node when that node is actually rendering their value.
      const ownsMediaSource = !nextProps
        || !('src' in nextProps)
        || hasProvenanceValue
        || editableValuesMatch(nextProps.src, textOverride);
      if (!ownsMediaSource && nextProps && 'src' in nextProps) {
        const { 'data-editable': _unsafeMediaMarker, ...rest } = nextProps;
        void _unsafeMediaMarker;
        nextProps = rest;
      }
      const ownsTransform = (
        !hasSameIdEditableDescendant(renderedChildren, id)
        && ownsMediaSource
      );
      const ownsTextLeaf = (
        ownsTransform
        && typeof type === 'string'
        && renderedChildren.length > 0
        && renderedChildren.every(child =>
          child == null
          || child === false
          || typeof child === 'string'
          || typeof child === 'number'
        )
      );
      if (
        ownsTextLeaf
        && (typeof textOverride === 'string' || typeof textOverride === 'number')
      ) {
        if (hasProvenanceValue) {
          const replaceProvenanceChild = (child: React.ReactNode): React.ReactNode => {
            if (Object.is(child, provenanceValue)) return textOverride;
            const childValue = normalizedEditableValue(child);
            const sourceValue = normalizedEditableValue(provenanceValue);
            return childValue != null && childValue === sourceValue ? textOverride : child;
          };
          if (nextChildren.length > 0) {
            nextChildren = nextChildren.map(replaceProvenanceChild);
          } else {
            nextProps = {
              ...nextProps,
              children: react.Children.map(
                nextProps.children as React.ReactNode,
                replaceProvenanceChild,
              ),
            };
          }
        } else if (nextChildren.length > 0) {
          nextChildren = [textOverride];
        } else {
          nextProps = { ...nextProps, children: textOverride };
        }
      }
      if (
        ownsTransform
        && typeof textOverride === 'string'
        && nextProps
        && 'src' in nextProps
      ) {
        nextProps = { ...nextProps, src: textOverride };
      }

      const position = currentProps[`_pos_${id}`] as
        | { x: number; y: number }
        | undefined;
      const scale = currentProps[`_scale_${id}`] as
        | { w: number; h: number }
        | undefined;
      const trimBefore = readFrameProp(`_trimBefore_${id}`);
      const trimAfter = readFrameProp(`_trimAfter_${id}`);

      if (
        currentTransformMode === 'proxy'
        && ownsTransform
        && (position || scale)
      ) {
        const existingStyle = (nextProps.style || {}) as Record<string, unknown>;
        nextProps = {
          ...nextProps,
          style: {
            ...existingStyle,
            ...(position
              ? { translate: `${position.x}px ${position.y}px` }
              : {}),
            ...(scale
              ? { scale: `${+scale.w.toFixed(4)} ${+scale.h.toFixed(4)}` }
              : {}),
          },
        };
      }

      if (ownsTransform && (trimBefore !== undefined || trimAfter !== undefined)) {
        if (type === videoComponent) {
          nextProps = {
            ...nextProps,
            ...(trimBefore !== undefined ? { trimBefore } : {}),
            ...(trimAfter !== undefined ? { trimAfter } : {}),
          };
        } else {
          nextChildren = nextChildren.map(child =>
            injectLegacyVideoTrim(child, { trimBefore, trimAfter })
          );
        }
      }

      if (type === videoComponent) {
        const existingClassName = typeof nextProps.className === 'string'
          ? nextProps.className.trim()
          : '';
        nextProps = {
          ...nextProps,
          className: [existingClassName, editableRuntimeClassName(id)]
            .filter(Boolean)
            .join(' '),
        };
      }
    }

    // Normalize only host-element text. Custom components should continue to
    // receive their original string props/children and will be normalized when
    // they eventually render a DOM text leaf.
    if (typeof type === 'string') {
      if (nextChildren.length > 0) {
        nextChildren = nextChildren.map(child => renderTextLineBreaks(react, child));
      } else if (nextProps && 'children' in nextProps) {
        nextProps = {
          ...nextProps,
          children: react.Children.map(
            nextProps.children as React.ReactNode,
            child => renderTextLineBreaks(react, child),
          ),
        };
      }
    }

    return originalCreateElement.call(
      react,
      type,
      nextProps,
      ...nextChildren,
    );
  };

  const patchedReact = new Proxy(react, {
    get(target, prop) {
      if (prop === 'createElement') return patchedCreateElement;
      if (prop === '__makaronEditableId') return resolveEditableId;
      return Reflect.get(target, prop);
    },
  });

  return {
    React: patchedReact,
    wrap(Component, transformMode) {
      return function EditableRuntimeComposition(props: Record<string, unknown>) {
        currentProps = props;
        currentTransformMode = transformMode;
        return originalCreateElement.call(react, Component, props);
      };
    },
  };
}
