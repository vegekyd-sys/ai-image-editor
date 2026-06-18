import type { ArtifactCompletionAction } from '@/types';

function sanitizeAction(action: Partial<ArtifactCompletionAction>): ArtifactCompletionAction | null {
  if (!action.label || !action.prompt) return null;
  return {
    label: String(action.label).slice(0, 32),
    prompt: String(action.prompt),
    ...(action.description ? { description: String(action.description).slice(0, 120) } : {}),
    policy: action.policy === 'auto' ? 'auto' : 'confirm',
  };
}

function hasBalancedJsonObject(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
  }

  return depth === 0 && text.trim().startsWith('{') && text.trim().endsWith('}');
}

export function serializeCompletionActions(actions?: ArtifactCompletionAction[]) {
  if (!actions?.length) return '';
  return actions
    .slice(0, 4)
    .map(sanitizeAction)
    .filter((action): action is ArtifactCompletionAction => !!action)
    .map(action => `action:${JSON.stringify(action)}`)
    .join('\n');
}

export function splitCompletionActions(content: string): {
  text: string;
  actions: ArtifactCompletionAction[];
} {
  const actions: ArtifactCompletionAction[] = [];
  const keptLines: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const actionStart = line.search(/\baction:\s*\{/);

    if (actionStart === -1) {
      keptLines.push(line);
      continue;
    }

    const prefix = line.slice(0, actionStart).trimEnd();
    if (prefix) keptLines.push(prefix);

    let payload = line.slice(actionStart).replace(/^action:\s*/, '');
    while (!hasBalancedJsonObject(payload) && i + 1 < lines.length) {
      i += 1;
      payload += `\n${lines[i]}`;
    }

    try {
      const parsed = sanitizeAction(JSON.parse(payload) as Partial<ArtifactCompletionAction>);
      if (parsed && !actions.some(action => action.label === parsed.label && action.prompt === parsed.prompt)) {
        actions.push(parsed);
      }
    } catch {
      // Legacy or malformed action metadata should never leak into chat text.
    }
  }

  return {
    text: keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    actions: actions.slice(0, 4),
  };
}

export function parseCompletionActions(content: string): ArtifactCompletionAction[] {
  return splitCompletionActions(content).actions;
}

export function stripCompletionActionMarkers(content: string): string {
  return splitCompletionActions(content).text;
}
