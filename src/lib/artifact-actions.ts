import type { ArtifactCompletionAction, VideoMeta } from '@/types';
import type { Locale } from '@/lib/locales';

type VideoFailureCopy = {
  durationFallback: string;
  modelFallback: string;
  retryIntro: string;
  retryReason: (error: string) => string;
  retryUnknownReason: string;
  originalRequest: (prompt: string) => string;
  originalFallback: string;
  durationAndModel: (duration: string, model: string) => string;
  policyRetryInstruction: string;
  generalRetryInstruction: string;
  avoidIdenticalRetry: string;
  explainIntro: string;
  explainReason: (error: string) => string;
  explainUnknownReason: string;
  miniLabel: string;
  miniDescription: string;
  miniIntro: string;
  miniModelInstruction: (duration: string) => string;
  miniAvoid: string;
  policyRetryLabel: string;
  retryLabel: string;
  policyRetryDescription: string;
  retryDescription: string;
  matureRetryLabel: string;
  matureRetryDescription: string;
  matureRetryIntro: string;
  matureRetryInstruction: string;
  explainLabel: string;
  explainDescription: string;
};

const VIDEO_FAILURE_COPY: Record<Locale, VideoFailureCopy> = {
  en: {
    durationFallback: 'use the original duration',
    modelFallback: 'use a suitable video model',
    retryIntro: 'The last video generation failed. Please help me continue.',
    retryReason: error => `Failure reason: ${error}`,
    retryUnknownReason: 'The failure reason is unclear. Start by checking common video generation failures.',
    originalRequest: prompt => `Original script/request: ${prompt}`,
    originalFallback: 'Use the requirements and media from the previous video task.',
    durationAndModel: (duration, model) => `Duration: ${duration}; model: ${model}.`,
    policyRetryInstruction: 'First revise the description to be safer and more everyday, reducing visuals or wording likely to trigger moderation, then submit it again.',
    generalRetryInstruction: 'First determine whether this was moderation, media specifications, model limitations, or a temporary failure. Adjust the script, crop or replace media, or switch models if needed, then submit it again.',
    avoidIdenticalRetry: 'Do not resubmit the exact failed parameters. If this was an intermediate clip, continue with the originally intended next step after it succeeds.',
    explainIntro: 'Review why the last video failed and tell me the safest revision. Do not resubmit yet.',
    explainReason: error => `Failure reason: ${error}`,
    explainUnknownReason: 'The failure reason is currently unclear.',
    miniLabel: 'Retry with Fast',
    miniDescription: 'Mini service failed; switch to the more reliable Fast model',
    miniIntro: 'SeeDance Mini failed its service authentication or availability check. Regenerate with SeeDance 2.0 Fast.',
    miniModelInstruction: duration => `Duration: ${duration}; change the model to seedance-fast and use 480p unless I explicitly request higher resolution.`,
    miniAvoid: 'Do not retry with seedance-mini using the same parameters.',
    policyRetryLabel: 'Make safer & retry',
    retryLabel: 'Adjust & retry',
    policyRetryDescription: 'Revise it into a version more likely to pass moderation',
    retryDescription: 'Adjust based on the failure reason, then generate again',
    matureRetryLabel: 'Retry with Mature Mode',
    matureRetryDescription: 'Retry once with the relaxed filter · +10% cost',
    matureRetryIntro: 'Retry the same request once with Seedance 2.5 Mature Mode.',
    matureRetryInstruction: 'Call generate_animation exactly once with model: seedance-2.5 and content_filter: false. Keep the original request, duration, resolution, aspect ratio, and media references unchanged. This mode costs +10%. If it is rejected again, stop and explain the failure; do not retry repeatedly.',
    explainLabel: 'Review the cause',
    explainDescription: 'Analyze the failure without retrying yet',
  },
  zh: {
    durationFallback: '沿用原时长',
    modelFallback: '沿用合适的视频模型',
    retryIntro: '刚才这个视频生成失败了，帮我继续处理一下。',
    retryReason: error => `失败原因：${error}`,
    retryUnknownReason: '失败原因现在不明确，先按常见的视频生成失败来判断。',
    originalRequest: prompt => `原来的脚本/要求是：${prompt}`,
    originalFallback: '沿用刚才这次视频任务的要求和素材。',
    durationAndModel: (duration, model) => `时长：${duration}；模型：${model}。`,
    policyRetryInstruction: '先把描述改得更安全、更日常一点，弱化容易被审核拦截的画面或措辞，再重新提交生成。',
    generalRetryInstruction: '先判断是审核、素材规格、模型限制还是临时失败；必要时调整脚本、裁剪/换用合适素材或换模型，然后重新提交生成。',
    avoidIdenticalRetry: '不要原样重复提交刚才失败的参数。如果这本来是一个中间片段，成功后继续给出原本该做的下一步。',
    explainIntro: '看一下刚才这个视频为什么失败，告诉我最稳的修改方式，先不要重新提交。',
    explainReason: error => `失败原因：${error}`,
    explainUnknownReason: '失败原因现在不明确。',
    miniLabel: '用 Fast 重试',
    miniDescription: 'Mini 服务侧失败，切到更稳的 Fast',
    miniIntro: '刚才 SeeDance Mini 在服务侧鉴权/可用性检查失败了，请用 SeeDance 2.0 Fast 重新生成。',
    miniModelInstruction: duration => `时长：${duration}；模型改为 seedance-fast；分辨率用 480p，除非我明确要求更高清。`,
    miniAvoid: '不要再用 seedance-mini 原样重试。',
    policyRetryLabel: '改安全点重试',
    retryLabel: '调整后重试',
    policyRetryDescription: '换成更容易通过审核的版本',
    retryDescription: '根据失败原因改一下再生成',
    matureRetryLabel: '用 Mature Mode 重试',
    matureRetryDescription: '放宽内容过滤后重试一次 · 费用 +10%',
    matureRetryIntro: '用 Seedance 2.5 Mature Mode 原样重试一次刚才的请求。',
    matureRetryInstruction: '只调用一次 generate_animation，并明确传 model: seedance-2.5 和 content_filter: false。保持原要求、时长、分辨率、画幅和全部素材引用不变。这个模式费用 +10%。如果再次被拒，立即停止并解释原因，不要循环重试。',
    explainLabel: '先看原因',
    explainDescription: '先分析失败点，不立刻重试',
  },
  'zh-Hant': {
    durationFallback: '沿用原本時長',
    modelFallback: '沿用合適的影片模型',
    retryIntro: '剛才這個影片產生失敗了，請幫我繼續處理。',
    retryReason: error => `失敗原因：${error}`,
    retryUnknownReason: '目前無法確定失敗原因，請先從常見的影片產生失敗情況判斷。',
    originalRequest: prompt => `原本的腳本／要求是：${prompt}`,
    originalFallback: '沿用剛才這次影片任務的要求和素材。',
    durationAndModel: (duration, model) => `時長：${duration}；模型：${model}。`,
    policyRetryInstruction: '請先把描述調整得更安全、更日常，弱化容易被審核攔截的畫面或措辭，再重新提交產生。',
    generalRetryInstruction: '請先判斷是審核、素材規格、模型限制或暫時性失敗；必要時調整腳本、裁切或更換合適素材，或改用其他模型，再重新提交產生。',
    avoidIdenticalRetry: '不要原樣重複提交剛才失敗的參數。如果這原本是中間片段，成功後請繼續原本預定的下一步。',
    explainIntro: '請查看剛才這個影片為何失敗，告訴我最穩妥的修改方式，暫時不要重新提交。',
    explainReason: error => `失敗原因：${error}`,
    explainUnknownReason: '目前無法確定失敗原因。',
    miniLabel: '改用 Fast 重試',
    miniDescription: 'Mini 服務失敗，切換到較穩定的 Fast',
    miniIntro: '剛才 SeeDance Mini 的服務驗證或可用性檢查失敗，請改用 SeeDance 2.0 Fast 重新產生。',
    miniModelInstruction: duration => `時長：${duration}；模型改為 seedance-fast；除非我明確要求更高畫質，否則使用 480p。`,
    miniAvoid: '不要再用相同參數重試 seedance-mini。',
    policyRetryLabel: '調整安全後重試',
    retryLabel: '調整後重試',
    policyRetryDescription: '改成更容易通過審核的版本',
    retryDescription: '根據失敗原因調整後再產生',
    matureRetryLabel: '用 Mature Mode 重試',
    matureRetryDescription: '放寬內容過濾後重試一次 · 費用 +10%',
    matureRetryIntro: '用 Seedance 2.5 Mature Mode 原樣重試一次剛才的要求。',
    matureRetryInstruction: '只呼叫一次 generate_animation，並明確傳入 model: seedance-2.5 和 content_filter: false。保持原要求、時長、解析度、畫幅和全部素材引用不變。此模式費用 +10%。若再次被拒，立即停止並解釋原因，不要循環重試。',
    explainLabel: '先查看原因',
    explainDescription: '先分析失敗原因，暫不重試',
  },
  ja: {
    durationFallback: '元の長さを使用',
    modelFallback: '適切な動画モデルを使用',
    retryIntro: '先ほどの動画生成に失敗しました。続きの対応をお願いします。',
    retryReason: error => `失敗理由：${error}`,
    retryUnknownReason: '失敗理由が不明です。まず一般的な動画生成エラーとして確認してください。',
    originalRequest: prompt => `元の台本／要件：${prompt}`,
    originalFallback: '直前の動画タスクの要件と素材を使用してください。',
    durationAndModel: (duration, model) => `長さ：${duration}、モデル：${model}。`,
    policyRetryInstruction: 'まず説明をより安全で日常的な表現に直し、審査に抵触しやすい映像や文言を弱めてから再生成してください。',
    generalRetryInstruction: 'まず審査、素材仕様、モデル制限、一時的な障害のどれかを判断してください。必要に応じて台本の調整、素材のトリミングや差し替え、モデル変更を行ってから再生成してください。',
    avoidIdenticalRetry: '失敗したパラメータをそのまま再送信しないでください。中間クリップの場合は、成功後に当初予定していた次のステップへ進んでください。',
    explainIntro: '先ほどの動画が失敗した理由を確認し、最も確実な修正方法を教えてください。まだ再送信はしないでください。',
    explainReason: error => `失敗理由：${error}`,
    explainUnknownReason: '現時点では失敗理由が不明です。',
    miniLabel: 'Fastで再試行',
    miniDescription: 'Miniサービスの失敗を受け、より安定したFastへ切り替えます',
    miniIntro: 'SeeDance Miniのサービス認証または可用性チェックに失敗しました。SeeDance 2.0 Fastで再生成してください。',
    miniModelInstruction: duration => `長さ：${duration}、モデルをseedance-fastへ変更し、明示的に高解像度を指定していない限り480pを使用してください。`,
    miniAvoid: '同じパラメータのままseedance-miniで再試行しないでください。',
    policyRetryLabel: '安全に直して再試行',
    retryLabel: '調整して再試行',
    policyRetryDescription: '審査を通過しやすい内容に修正します',
    retryDescription: '失敗理由に合わせて調整し、再生成します',
    matureRetryLabel: 'Mature Modeで再試行',
    matureRetryDescription: 'フィルターを緩和して一度だけ再試行 · 料金 +10%',
    matureRetryIntro: '同じリクエストをSeedance 2.5 Mature Modeで一度だけ再試行してください。',
    matureRetryInstruction: 'generate_animationを一度だけ呼び出し、model: seedance-2.5 と content_filter: false を明示してください。元の要件、長さ、解像度、アスペクト比、すべての素材参照は変更しないでください。このモードは料金が +10% です。再び拒否された場合は停止して理由を説明し、繰り返し再試行しないでください。',
    explainLabel: '原因を確認',
    explainDescription: 'まだ再試行せず、失敗理由を分析します',
  },
};

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

/** Mature Mode relaxes output moderation; it does not waive input identity or IP restrictions. */
function isMatureModeIneligibleInputFailure(error?: string | null): boolean {
  const text = String(error || '').toLowerCase();
  return [
    'real person',
    'copyrighted',
    'trademarked',
    'trademark',
    'logos',
    'ip characters',
  ].some(keyword => text.includes(keyword));
}

export function buildVideoFailureActions(
  videoMeta: Partial<VideoMeta> | null | undefined,
  locale: Locale,
): ArtifactCompletionAction[] {
  const copy = VIDEO_FAILURE_COPY[locale];
  const error = compact(videoMeta?.error, 420);
  const prompt = compact(videoMeta?.prompt, 900);
  const isPolicyFailure = looksLikePolicyFailure(error);
  const isMatureRetry = isPolicyFailure &&
    String(videoMeta?.model || '') === 'seedance-2.5' &&
    videoMeta?.contentFilter !== false &&
    !isMatureModeIneligibleInputFailure(error);
  const isMiniServiceAuthFailure = String(videoMeta?.model || '') === 'seedance-mini' &&
    /service authentication failed|service_unavailable|internal service authentication/i.test(error);
  const duration = typeof videoMeta?.duration === 'number' && Number.isFinite(videoMeta.duration)
    ? `${videoMeta.duration}s`
    : copy.durationFallback;
  const model = videoMeta?.model ? String(videoMeta.model) : copy.modelFallback;

  const retryPrompt = [
    copy.retryIntro,
    error ? copy.retryReason(error) : copy.retryUnknownReason,
    copy.originalRequest(prompt || copy.originalFallback),
    copy.durationAndModel(duration, model),
    isPolicyFailure
      ? copy.policyRetryInstruction
      : copy.generalRetryInstruction,
    copy.avoidIdenticalRetry,
  ].join('\n');

  const explainPrompt = [
    copy.explainIntro,
    error ? copy.explainReason(error) : copy.explainUnknownReason,
    prompt ? copy.originalRequest(prompt) : '',
  ].filter(Boolean).join('\n');

  const matureRetryPrompt = [
    copy.matureRetryIntro,
    error ? copy.retryReason(error) : copy.retryUnknownReason,
    copy.originalRequest(prompt || copy.originalFallback),
    copy.durationAndModel(duration, 'seedance-2.5'),
    copy.matureRetryInstruction,
  ].join('\n');

  const actions: ArtifactCompletionAction[] = [];

  if (isMiniServiceAuthFailure) {
    actions.push({
      label: copy.miniLabel,
      description: copy.miniDescription,
      prompt: [
        copy.miniIntro,
        copy.originalRequest(prompt || copy.originalFallback),
        copy.miniModelInstruction(duration),
        copy.miniAvoid,
      ].join('\n'),
      policy: 'confirm',
    });
  }

  actions.push(
    {
      label: isMatureRetry
        ? copy.matureRetryLabel
        : isPolicyFailure ? copy.policyRetryLabel : copy.retryLabel,
      description: isMatureRetry
        ? copy.matureRetryDescription
        : isPolicyFailure ? copy.policyRetryDescription : copy.retryDescription,
      prompt: isMatureRetry ? matureRetryPrompt : retryPrompt,
      policy: 'confirm',
    },
    {
      label: copy.explainLabel,
      description: copy.explainDescription,
      prompt: explainPrompt,
      policy: 'confirm',
    },
  );

  return actions.slice(0, 4);
}
