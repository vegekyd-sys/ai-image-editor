'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type StageStatus = 'pending' | 'in_progress' | 'awaiting_approval' | 'completed' | 'invalidated' | 'failed';

export interface StudioRunStageSummary {
  id: string;
  status: StageStatus;
  artifactVersion: number;
  artifactPath?: string;
  artifactCreatedAt?: string;
  stageUpdatedAt: string;
}

export interface StudioRunSummary {
  runId: string;
  title: string;
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  currentStage: string | null;
  approvalPolicy: 'auto' | 'guided' | 'manual';
  stages: StudioRunStageSummary[];
  updatedAt: string;
}

export interface StudioRunViewModel {
  run: StudioRunSummary | null;
  artifacts: Record<string, unknown>;
}

function dismissalKey(runId: string): string {
  return `makaron:studio-run-progress-dismissed:${runId}`;
}

const stageLabels: Record<string, { short: string; title: string }> = {
  brief: { short: 'Brief', title: '创作简报' },
  proposal: { short: 'Proposal', title: '创意提案' },
  script: { short: 'Script', title: '解说脚本' },
  storyboard: { short: 'Board', title: '故事板' },
  assets: { short: 'Assets', title: '资产清单' },
  composition: { short: 'Compose', title: '合成制作' },
  review: { short: 'Review', title: '成片审查' },
  delivery: { short: 'Delivery', title: '交付归档' },
};

const statusLabels: Record<StageStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  awaiting_approval: '待审批',
  completed: '已完成',
  invalidated: '需更新',
  failed: '失败',
};

function statusColor(status: StageStatus) {
  if (status === 'completed') return '#c026d3';
  if (status === 'in_progress') return '#e879f9';
  if (status === 'awaiting_approval') return '#fbbf24';
  if (status === 'invalidated' || status === 'failed') return '#fb7185';
  return 'rgba(255,255,255,0.18)';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberText(value: unknown): string {
  return typeof value === 'number' ? String(value) : '';
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function fileName(path: unknown): string {
  const value = text(path);
  return value.split('/').pop() || value;
}

function firstLine(...values: unknown[]): string {
  return values.map(text).find(Boolean) || '';
}

function artifactPreview(stageId: string, artifact: unknown): string {
  if (!isRecord(artifact)) return '';

  if (stageId === 'brief') {
    return firstLine(artifact.coreMessage, artifact.objective, artifact.title);
  }
  if (stageId === 'proposal') {
    const concepts = recordArray(artifact.concepts);
    const selected = concepts.find(concept => concept.id === artifact.selectedConceptId) || concepts[0];
    return firstLine(selected?.title, selected?.hook, artifact.rationale);
  }
  if (stageId === 'script') {
    const sections = recordArray(artifact.sections);
    return `${sections.length} 段 · ${numberText(artifact.totalDurationSeconds)} 秒${sections[0]?.narration ? ` · ${text(sections[0].narration)}` : ''}`;
  }
  if (stageId === 'storyboard') {
    const scenes = recordArray(artifact.scenes);
    return `${scenes.length} 个场景${artifact.artDirection ? ` · ${text(artifact.artDirection)}` : ''}`;
  }
  if (stageId === 'assets') {
    const assets = recordArray(artifact.assets);
    return `${assets.length} 项资产 · 全部就绪${typeof artifact.totalCostUsd === 'number' ? ` · $${artifact.totalCostUsd.toFixed(2)}` : ''}`;
  }
  if (stageId === 'composition') {
    return `${numberText(artifact.width)}×${numberText(artifact.height)} · ${numberText(artifact.fps)} FPS · ${numberText(artifact.durationSeconds)} 秒 · ${artifact.editable ? '可编辑' : '已固化'}`;
  }
  if (stageId === 'review') {
    const technical = isRecord(artifact.technical) ? artifact.technical : {};
    return `${artifact.status === 'pass' ? '审查通过' : '需要修改'} · ${text(technical.resolution)} · ${numberText(technical.fps)} FPS`;
  }
  if (stageId === 'delivery') {
    return `${fileName(artifact.outputPath)} · 保留可编辑源文件`;
  }
  return '';
}

const StudioRunPanelContext = createContext(false);

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const isPanel = useContext(StudioRunPanelContext);
  if (!children) return null;
  return (
    <div className={`grid gap-3 py-2 ${isPanel ? 'grid-cols-[72px_1fr]' : 'grid-cols-[92px_1fr]'}`}>
      <span className={isPanel ? 'text-[11px]' : 'text-[13px]'} style={{ color: 'rgba(255,255,255,0.34)' }}>{label}</span>
      <div className={`${isPanel ? 'text-[15px]' : 'text-[19px]'} leading-[1.65] whitespace-pre-wrap`} style={{ color: 'rgba(255,255,255,0.76)' }}>{children}</div>
    </div>
  );
}

function TimedItems({ items, kind }: { items: Record<string, unknown>[]; kind: 'script' | 'storyboard' }) {
  const isPanel = useContext(StudioRunPanelContext);
  return (
    <div className="mt-2 divide-y divide-white/[0.055]">
      {items.map((item, index) => (
        <div key={text(item.id) || index} className={`grid gap-3 py-3 ${isPanel ? 'grid-cols-[52px_1fr]' : 'grid-cols-[68px_1fr]'}`}>
          <span className={`${isPanel ? 'text-[11px]' : 'text-[13px]'} tabular-nums pt-0.5`} style={{ color: 'rgba(232,121,249,0.72)' }}>
            {numberText(item.startSeconds)}–{numberText(item.endSeconds)}s
          </span>
          <div className="min-w-0">
            <div className={`${isPanel ? 'text-[15px]' : 'text-[19px]'} leading-[1.65] whitespace-pre-wrap`} style={{ color: 'rgba(255,255,255,0.78)' }}>
              {kind === 'script' ? text(item.narration) : firstLine(item.purpose, item.focalPoint)}
            </div>
            {kind === 'script' && Array.isArray(item.onScreenText) && item.onScreenText.length > 0 && (
              <div className={`mt-1 ${isPanel ? 'text-[11px]' : 'text-[14px]'}`} style={{ color: 'rgba(255,255,255,0.4)' }}>
                屏幕文字：{item.onScreenText.map(text).filter(Boolean).join(' / ')}
              </div>
            )}
            {kind === 'storyboard' && (
              <div className={`mt-1 ${isPanel ? 'text-[11px]' : 'text-[14px]'} leading-[1.55]`} style={{ color: 'rgba(255,255,255,0.4)' }}>
                {[text(item.visualTreatment), text(item.transitionOut)].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactDetail({ stageId, artifact }: { stageId: string; artifact: unknown }) {
  const isPanel = useContext(StudioRunPanelContext);
  if (!isRecord(artifact)) {
    return <div className={`py-2 ${isPanel ? 'text-[13px]' : 'text-[17px]'}`} style={{ color: 'rgba(255,255,255,0.36)' }}>正在读取阶段内容…</div>;
  }

  if (stageId === 'brief') return (
    <div>
      <DetailRow label="目标">{text(artifact.objective)}</DetailRow>
      <DetailRow label="受众">{text(artifact.audience)}</DetailRow>
      <DetailRow label="核心信息">{text(artifact.coreMessage)}</DetailRow>
      <DetailRow label="规格">{numberText(artifact.durationSeconds)} 秒 · {text(artifact.aspectRatio)} · {text(artifact.language)}</DetailRow>
    </div>
  );

  if (stageId === 'proposal') {
    const concepts = recordArray(artifact.concepts);
    const selected = concepts.find(concept => concept.id === artifact.selectedConceptId) || concepts[0];
    return (
      <div>
        <DetailRow label="选定方向">{text(selected?.title)}</DetailRow>
        <DetailRow label="开场钩子">{text(selected?.hook)}</DetailRow>
        <DetailRow label="视觉方向">{text(selected?.visualDirection)}</DetailRow>
        <DetailRow label="动态语言">{text(selected?.motionLanguage)}</DetailRow>
        <DetailRow label="选择理由">{text(artifact.rationale)}</DetailRow>
      </div>
    );
  }

  if (stageId === 'script') return <TimedItems items={recordArray(artifact.sections)} kind="script" />;

  if (stageId === 'storyboard') return (
    <div>
      <DetailRow label="美术方向">{text(artifact.artDirection)}</DetailRow>
      <DetailRow label="版式约束">{text(artifact.layoutContract)}</DetailRow>
      <TimedItems items={recordArray(artifact.scenes)} kind="storyboard" />
    </div>
  );

  if (stageId === 'assets') return (
    <div className="mt-1 divide-y divide-white/[0.055]">
      {recordArray(artifact.assets).map((asset, index) => (
        <div key={text(asset.id) || index} className="flex items-start gap-3 py-2.5">
          <span className="text-[9px] uppercase w-11 flex-shrink-0 pt-0.5" style={{ color: 'rgba(232,121,249,0.72)' }}>{text(asset.type)}</span>
          <div className="min-w-0">
            <div className={`${isPanel ? 'text-[13px]' : 'text-[17px]'} break-all`} style={{ color: 'rgba(255,255,255,0.72)' }}>{text(asset.path)}</div>
            <div className={`${isPanel ? 'text-[10px]' : 'text-[13px]'} mt-1`} style={{ color: 'rgba(255,255,255,0.34)' }}>{text(asset.source)}</div>
          </div>
        </div>
      ))}
    </div>
  );

  if (stageId === 'composition') return (
    <div>
      <DetailRow label="运行时">{text(artifact.runtime)} · {text(artifact.mode)}</DetailRow>
      <DetailRow label="画面规格">{numberText(artifact.width)}×{numberText(artifact.height)} · {numberText(artifact.fps)} FPS · {numberText(artifact.durationSeconds)} 秒</DetailRow>
      <DetailRow label="设计源文件">{text(artifact.designPath)}</DetailRow>
      <DetailRow label="可编辑">{artifact.editable ? '是' : '否'}</DetailRow>
    </div>
  );

  if (stageId === 'review') {
    const technical = isRecord(artifact.technical) ? artifact.technical : {};
    const visual = isRecord(artifact.visual) ? artifact.visual : {};
    const audio = isRecord(artifact.audio) ? artifact.audio : {};
    return (
      <div>
        <DetailRow label="结论">{artifact.status === 'pass' ? '通过' : text(artifact.status)}</DetailRow>
        <DetailRow label="技术检查">{text(technical.resolution)} · {numberText(technical.fps)} FPS · {technical.hasAudio ? '含音频' : '无音频'}</DetailRow>
        <DetailRow label="视觉检查">采样 {numberText(visual.framesSampled)} 帧 · {visual.blackFramesDetected ? '发现黑帧' : '无黑帧'} · {visual.overlapDetected ? '发现遮挡' : '无元素遮挡'}</DetailRow>
        <DetailRow label="音频检查">{numberText(audio.integratedLufs)} LUFS · True Peak {numberText(audio.truePeakDbfs)} dBFS</DetailRow>
      </div>
    );
  }

  if (stageId === 'delivery') return (
    <div>
      <DetailRow label="成片">{text(artifact.outputPath)}</DetailRow>
      <DetailRow label="可编辑源">{text(artifact.editableSourcePath)}</DetailRow>
      {typeof artifact.sha256 === 'string' && artifact.sha256 ? (
        <DetailRow label="校验值">{artifact.sha256}</DetailRow>
      ) : null}
      <DetailRow label="交付时间">{text(artifact.deliveredAt)}</DetailRow>
    </div>
  );

  return <pre className={`${isPanel ? 'text-[12px]' : 'text-[16px]'} whitespace-pre-wrap break-all`} style={{ color: 'rgba(255,255,255,0.62)' }}>{JSON.stringify(artifact, null, 2)}</pre>;
}

export function useStudioRun(projectId: string | undefined, active: boolean): StudioRunViewModel {
  const [run, setRun] = useState<StudioRunSummary | null>(null);
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>({});

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/projects/${projectId}/studio-runs`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { runs?: StudioRunSummary[]; artifacts?: Record<string, unknown> };
      setRun(data.runs?.[0] || null);
      setArtifacts(data.artifacts || {});
    } catch {
      // Studio Run UI is supplementary; chat remains usable when status refresh fails.
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    if (!active) return;
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  return { run, artifacts };
}

export function StudioRunProgress({
  studioRun,
  isAgentActive = false,
  latestUserMessageTimestamp,
}: {
  studioRun: StudioRunViewModel;
  isAgentActive?: boolean;
  latestUserMessageTimestamp?: number;
}) {
  const { run, artifacts } = studioRun;
  const [expanded, setExpanded] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const completed = useMemo(() => run?.stages.filter(stage => stage.status === 'completed').length || 0, [run]);
  const runId = run?.runId;

  useEffect(() => {
    if (!runId) return;
    setExpanded(false);
    setDismissedRunId(window.sessionStorage.getItem(dismissalKey(runId)) === 'true' ? runId : null);
  }, [runId]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnNextPointer = (event: PointerEvent) => {
      if (toggleRef.current?.contains(event.target as Node)) return;
      setExpanded(false);
    };
    document.addEventListener('pointerdown', closeOnNextPointer);
    return () => document.removeEventListener('pointerdown', closeOnNextPointer);
  }, [expanded]);

  if (!run || dismissedRunId === run.runId) return null;

  const isTerminal = run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed';
  const hasNewerUserRequest = isTerminal
    && typeof latestUserMessageTimestamp === 'number'
    && latestUserMessageTimestamp > Date.parse(run.updatedAt);
  if (hasNewerUserRequest) return null;

  const canDismiss = isTerminal || !isAgentActive;

  const dismiss = () => {
    window.sessionStorage.setItem(dismissalKey(run.runId), 'true');
    setExpanded(false);
    setDismissedRunId(run.runId);
  };

  const currentLabel = run.currentStage ? stageLabels[run.currentStage]?.title : null;
  return (
    <section data-testid="studio-run-progress" className="relative px-1 pb-2.5">
      {expanded && (
        <div data-testid="studio-run-progress-table" className="mb-3 max-h-[38vh] overflow-y-auto border-b border-white/[0.07]">
          {run.stages.map((stage, index) => {
            const visualStatus: StageStatus = stage.id === run.currentStage && run.status === 'running' && stage.status === 'pending'
              ? 'in_progress'
              : stage.status;
            const artifact = stage.artifactPath ? artifacts[stage.artifactPath] : undefined;
            const preview = artifactPreview(stage.id, artifact);
            return (
              <div key={stage.id} className="grid grid-cols-[20px_1fr_auto] gap-2 py-2.5 border-t border-white/[0.055] first:border-t-0">
                <span className="text-[9px] tabular-nums pt-0.5" style={{ color: 'rgba(255,255,255,0.24)' }}>{index + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor(visualStatus) }} />
                    <span className="text-[11px]" style={{ color: visualStatus === 'pending' ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.76)' }}>{stageLabels[stage.id]?.title || stage.id}</span>
                  </div>
                  {preview && <div className="mt-1 pl-3.5 text-[9px] truncate" style={{ color: 'rgba(255,255,255,0.32)' }}>{preview}</div>}
                </div>
                <span className="text-[9px] pt-0.5" style={{ color: statusColor(visualStatus) }}>{statusLabels[visualStatus]}</span>
              </div>
            );
          })}
        </div>
      )}

      <button
        ref={toggleRef}
        type="button"
        data-testid="studio-run-progress-toggle"
        onClick={() => setExpanded(value => !value)}
        className="w-full pr-7 text-left active:opacity-70 transition-opacity"
        aria-expanded={expanded}
        aria-label="Studio Run 总进度"
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'rgba(255,255,255,0.52)', letterSpacing: 0 }}>Studio Run</span>
          <span className="text-[10px] truncate flex-1" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {currentLabel ? `正在进行：${currentLabel}` : run.status === 'completed' ? `已完成：${run.title}` : run.title}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: run.status === 'completed' ? '#e879f9' : 'rgba(255,255,255,0.42)' }}>{completed}/{run.stages.length}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease' }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <div className="grid grid-cols-8 gap-1.5" aria-label="Studio Run progress">
          {run.stages.map(stage => {
            const visualStatus: StageStatus = stage.id === run.currentStage && run.status === 'running' && stage.status === 'pending'
              ? 'in_progress'
              : stage.status;
            return (
              <div key={stage.id} className="min-w-0" title={`${stageLabels[stage.id]?.title || stage.id}: ${statusLabels[visualStatus]}`}>
                <div className="h-1 rounded-full mb-1.5" style={{ background: statusColor(visualStatus) }} />
                <div className="text-[8px] truncate text-center" style={{ color: visualStatus === 'pending' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.48)' }}>
                  {stageLabels[stage.id]?.short || stage.id}
                </div>
              </div>
            );
          })}
        </div>
      </button>
      {canDismiss && (
        <button
          type="button"
          data-testid="studio-run-progress-dismiss"
          onClick={dismiss}
          className="absolute right-1 top-0 flex h-5 w-5 items-center justify-center text-[17px] leading-none transition-opacity hover:opacity-100"
          style={{ color: 'rgba(255,255,255,0.36)' }}
          aria-label="隐藏 Studio Run 进度"
          title="隐藏 Studio Run 进度"
        >
          ×
        </button>
      )}
    </section>
  );
}

export interface StudioRunStagePlacement {
  stage: StudioRunStageSummary;
  status: StageStatus;
  afterMessageIndex: number;
  timestamp: number;
}

export function buildStudioRunStagePlacements(
  messageTimestamps: number[],
  run: StudioRunSummary | null,
): StudioRunStagePlacement[] {
  if (!run) return [];

  return run.stages.flatMap(stage => {
    const isCurrent = stage.id === run.currentStage && run.status === 'running';
    const effectiveStatus: StageStatus = isCurrent && stage.status === 'pending' ? 'in_progress' : stage.status;
    const shouldShow = !!stage.artifactPath || effectiveStatus !== 'pending';
    if (!shouldShow) return [];

    const rawTimestamp = stage.artifactCreatedAt || (isCurrent ? run.updatedAt : stage.stageUpdatedAt);
    const parsedTimestamp = Date.parse(rawTimestamp);
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
    let afterMessageIndex = -1;
    for (let index = 0; index < messageTimestamps.length; index += 1) {
      if (messageTimestamps[index] <= timestamp) afterMessageIndex = index;
    }
    return [{ stage, status: effectiveStatus, afterMessageIndex, timestamp }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export function StudioRunStageCard({
  stage,
  status,
  artifact,
  ordinal,
  total,
  isPanel,
  onViewArtifact,
}: {
  stage: StudioRunStageSummary;
  status: StageStatus;
  artifact?: unknown;
  ordinal: number;
  total: number;
  isPanel: boolean;
  onViewArtifact?: (path: string) => void;
}) {
  const preview = artifactPreview(stage.id, artifact);
  const canExpand = !!stage.artifactPath;
  const [expanded, setExpanded] = useState(canExpand);

  return (
    <StudioRunPanelContext.Provider value={isPanel}>
    <article data-testid={`studio-run-stage-${stage.id}`} className="mt-3 mb-1">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => setExpanded(value => !value)}
        className="w-full text-left disabled:cursor-default"
        aria-expanded={canExpand ? expanded : undefined}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor(status), boxShadow: status === 'in_progress' ? '0 0 0 4px rgba(232,121,249,0.12)' : undefined }} />
          <span className={`${isPanel ? 'text-[16px]' : 'text-[20px]'} font-medium`} style={{ color: 'rgba(255,255,255,0.86)' }}>{stageLabels[stage.id]?.title || stage.id}</span>
          <span className={isPanel ? 'text-[10px]' : 'text-[12px]'} style={{ color: statusColor(status) }}>{statusLabels[status]}</span>
          <span className={isPanel ? 'text-[9px]' : 'text-[11px]'} style={{ color: 'rgba(255,255,255,0.28)' }}>Studio Run {ordinal}/{total}</span>
          <span className="flex-1" />
          {canExpand && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </div>
        {preview && !expanded && (
          <div className={`mt-1.5 pl-[18px] ${isPanel ? 'text-[15px]' : 'text-[20px]'} leading-[1.62] line-clamp-3`} style={{ color: 'rgba(255,255,255,0.78)' }}>{preview}</div>
        )}
        {!preview && status === 'in_progress' && (
          <div className={`mt-1.5 pl-[18px] ${isPanel ? 'text-[14px]' : 'text-[18px]'}`} style={{ color: 'rgba(255,255,255,0.5)' }}>正在生成这一阶段的内容…</div>
        )}
      </button>
      {expanded && (
        <div className="mt-3 pl-[18px] pr-1">
          <ArtifactDetail stageId={stage.id} artifact={artifact} />
          {stage.artifactPath && (
            <button
              type="button"
              onClick={() => onViewArtifact?.(stage.artifactPath!)}
              className={`mt-3 inline-flex items-center gap-1.5 ${isPanel ? 'text-[11px]' : 'text-[14px]'} active:opacity-60`}
              style={{ color: 'rgba(232,121,249,0.7)' }}
              aria-label={`打开${stageLabels[stage.id]?.title || stage.id}原始文件`}
            >
              打开原始文件
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
            </button>
          )}
        </div>
      )}
    </article>
    </StudioRunPanelContext.Provider>
  );
}
