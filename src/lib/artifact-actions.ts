import type { ArtifactCompletionAction, VideoMeta } from '@/types';

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

function compact(text?: string | null, max = 600): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function looksLikePolicyFailure(error?: string | null): boolean {
  const text = String(error || '').toLowerCase();
  return [
    'policy',
    'moderation',
    'content',
    'sensitive',
    'blocked',
    'safety',
    'nsfw',
    '审核',
    '敏感',
    '拦截',
    '违规',
    'risk',
  ].some(keyword => text.includes(keyword));
}

export function buildVideoFailureActions(videoMeta?: Partial<VideoMeta> | null): ArtifactCompletionAction[] {
  const error = compact(videoMeta?.error, 420);
  const prompt = compact(videoMeta?.prompt, 900);
  const isPolicyFailure = looksLikePolicyFailure(error);
  const isMiniServiceAuthFailure = String(videoMeta?.model || '') === 'seedance-mini' &&
    /service authentication failed|service_unavailable|internal service authentication/i.test(error);
  const duration = typeof videoMeta?.duration === 'number' && Number.isFinite(videoMeta.duration)
    ? `${videoMeta.duration}s`
    : '沿用原时长';
  const model = videoMeta?.model ? String(videoMeta.model) : '沿用合适的视频模型';

  const retryPrompt = [
    '刚才这个视频生成失败了，帮我继续处理一下。',
    error ? `失败原因：${error}` : '失败原因现在不明确，先按常见的视频生成失败来判断。',
    `原来的脚本/要求是：${prompt || '沿用刚才这次视频任务的要求和素材。'}`,
    `时长：${duration}；模型：${model}。`,
    isPolicyFailure
      ? '先把描述改得更安全、更日常一点，弱化容易被审核拦截的画面或措辞，再重新提交生成。'
      : '先判断是审核、素材规格、模型限制还是临时失败；必要时调整脚本、裁剪/换用合适素材或换模型，然后重新提交生成。',
    '不要原样重复提交刚才失败的参数。如果这本来是一个中间片段，成功后继续给出原本该做的下一步。',
  ].join('\n');

  const explainPrompt = [
    '看一下刚才这个视频为什么失败，告诉我最稳的修改方式，先不要重新提交。',
    error ? `失败原因：${error}` : '失败原因现在不明确。',
    prompt ? `原来的脚本/要求是：${prompt}` : '',
  ].filter(Boolean).join('\n');

  const actions: ArtifactCompletionAction[] = [];

  if (isMiniServiceAuthFailure) {
    actions.push({
      label: '用 Fast 重试',
      description: 'Mini 服务侧失败，切到更稳的 Fast',
      prompt: [
        '刚才 SeeDance Mini 在服务侧鉴权/可用性检查失败了，请用 SeeDance 2.0 Fast 重新生成。',
        `原来的脚本/要求是：${prompt || '沿用刚才这次视频任务的要求和素材。'}`,
        `时长：${duration}；模型改为 seedance-fast；分辨率用 480p，除非我明确要求更高清。`,
        '不要再用 seedance-mini 原样重试。',
      ].join('\n'),
      policy: 'confirm',
    });
  }

  actions.push(
    {
      label: isPolicyFailure ? '改安全点重试' : '调整后重试',
      description: isPolicyFailure ? '换成更容易通过审核的版本' : '根据失败原因改一下再生成',
      prompt: retryPrompt,
      policy: 'confirm',
    },
    {
      label: '先看原因',
      description: '先分析失败点，不立刻重试',
      prompt: explainPrompt,
      policy: 'confirm',
    },
  );

  return actions.slice(0, 4);
}
