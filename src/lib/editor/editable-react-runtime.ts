import type React from 'react';
import { editableRuntimeClassName } from './scene-registry';

export type EditableTransformMode = 'proxy' | 'registry';

type ReactRuntime = typeof React;

export interface EditableReactRuntime {
  React: ReactRuntime;
  wrap: (
    Component: React.ComponentType<any>,
    transformMode: EditableTransformMode,
  ) => React.ComponentType<any>;
}

export function createEditableReactRuntime(
  react: ReactRuntime,
  videoComponent: React.ElementType,
): EditableReactRuntime {
  let currentProps: Record<string, unknown> = {};
  let currentTransformMode: EditableTransformMode = 'proxy';
  const originalCreateElement = react.createElement;

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
      const renderedChildren = nextChildren.length > 0
        ? nextChildren
        : react.Children.toArray(nextProps.children as React.ReactNode);
      const ownsTransform = !hasSameIdEditableDescendant(renderedChildren, id);
      const textOverride = currentProps[id];
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
        if (nextChildren.length > 0) {
          nextChildren = [textOverride];
        } else {
          nextProps = { ...nextProps, children: textOverride };
        }
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
