const ESCAPED_LINE_BREAK_RE = /\\r\\n|\\n|\\r/g;

/**
 * Normalize text that crossed JSON/tool boundaries before it reaches any
 * Remotion renderer. Renderer bundles can be cached independently from the
 * app deployment, so doing this only in the React runtime is not sufficient.
 */
export function normalizeRemotionTextValue<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(ESCAPED_LINE_BREAK_RE, '\n') as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeRemotionTextValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeRemotionTextValue(item)]),
    ) as T;
  }

  return value;
}
