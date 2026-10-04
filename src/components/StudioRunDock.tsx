'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import type { Translate } from '@/lib/locales';

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

const stageLabelKeys = {
  brief: { short: 'studio.stage.brief.short', title: 'studio.stage.brief' },
  proposal: { short: 'studio.stage.proposal.short', title: 'studio.stage.proposal' },
  script: { short: 'studio.stage.script.short', title: 'studio.stage.script' },
  storyboard: { short: 'studio.stage.storyboard.short', title: 'studio.stage.storyboard' },
  assets: { short: 'studio.stage.assets.short', title: 'studio.stage.assets' },
  composition: { short: 'studio.stage.composition.short', title: 'studio.stage.composition' },
  review: { short: 'studio.stage.review.short', title: 'studio.stage.review' },
  delivery: { short: 'studio.stage.delivery.short', title: 'studio.stage.delivery' },
} as const;

const statusLabelKeys: Record<StageStatus, 'studio.status.pending' | 'studio.status.inProgress' | 'studio.status.awaitingApproval' | 'studio.status.completed' | 'studio.status.invalidated' | 'studio.status.failed'> = {
  pending: 'studio.status.pending',
  in_progress: 'studio.status.inProgress',
  awaiting_approval: 'studio.status.awaitingApproval',
  completed: 'studio.status.completed',
  invalidated: 'studio.status.invalidated',
  failed: 'studio.status.failed',
};

function stageLabel(t: Translate, stageId: string, variant: 'short' | 'title' = 'title'): string {
  const keys = stageLabelKeys[stageId as keyof typeof stageLabelKeys];
  return keys ? t(keys[variant]) : stageId;
}

function statusLabel(t: Translate, status: StageStatus): string {
  return t(statusLabelKeys[status]);
}

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

function reviewStatusLabel(t: Translate, status: unknown): string {
  if (status === 'pass') return t('studio.detail.pass');
  if (status === 'revise') return t('studio.detail.revise');
  if (status === 'fail') return t('studio.detail.fail');
  return text(status);
}

function artifactPreview(t: Translate, stageId: string, artifact: unknown): string {
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
    return `${t('studio.unit.sections', sections.length)} · ${t('studio.unit.seconds', numberText(artifact.totalDurationSeconds))}${sections[0]?.narration ? ` · ${text(sections[0].narration)}` : ''}`;
  }
  if (stageId === 'storyboard') {
    const scenes = recordArray(artifact.scenes);
    return `${t('studio.unit.scenes', scenes.length)}${artifact.artDirection ? ` · ${text(artifact.artDirection)}` : ''}`;
  }
  if (stageId === 'assets') {
    const assets = recordArray(artifact.assets);
    return `${t('studio.unit.assets', assets.length)} · ${t('studio.preview.allAssetsReady')}${typeof artifact.totalCostUsd === 'number' ? ` · $${artifact.totalCostUsd.toFixed(2)}` : ''}`;
  }
  if (stageId === 'composition') {
    return `${numberText(artifact.width)}×${numberText(artifact.height)} · ${numberText(artifact.fps)} FPS · ${t('studio.unit.seconds', numberText(artifact.durationSeconds))} · ${artifact.editable ? t('studio.preview.editable') : t('studio.preview.flattened')}`;
  }
  if (stageId === 'review') {
    const technical = isRecord(artifact.technical) ? artifact.technical : {};
    return `${reviewStatusLabel(t, artifact.status)} · ${text(technical.resolution)} · ${numberText(technical.fps)} FPS`;
  }
  if (stageId === 'delivery') {
    return `${fileName(artifact.outputPath)} · ${t('studio.preview.sourcePreserved')}`;
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
  const { t } = useLocale();
  return (
    <div className="mt-2 divide-y divide-white/[0.055]">
      {items.map((item, index) => (
        <div key={text(item.id) || index} className={`grid gap-3 py-3 ${isPanel ? 'grid-cols-[52px_1fr]' : 'grid-cols-[68px_1fr]'}`}>
          <span className={`${isPanel ? 'text-[11px]' : 'text-[13px]'} tabular-nums pt-0.5`} style={{ color: 'rgba(232,121,249,0.72)' }}>
            {t('studio.unit.secondRange', numberText(item.startSeconds), numberText(item.endSeconds))}
          </span>
          <div className="min-w-0">
            <div className={`${isPanel ? 'text-[15px]' : 'text-[19px]'} leading-[1.65] whitespace-pre-wrap`} style={{ color: 'rgba(255,255,255,0.78)' }}>
              {kind === 'script' ? text(item.narration) : firstLine(item.purpose, item.focalPoint)}
            </div>
            {kind === 'script' && Array.isArray(item.onScreenText) && item.onScreenText.length > 0 && (
              <div className={`mt-1 ${isPanel ? 'text-[11px]' : 'text-[14px]'}`} style={{ color: 'rgba(255,255,255,0.4)' }}>
                {t('studio.detail.onScreenText')}{t('studio.detail.labelSeparator')}{item.onScreenText.map(text).filter(Boolean).join(' / ')}
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
  const { t } = useLocale();
  if (!isRecord(artifact)) {
    return <div className={`py-2 ${isPanel ? 'text-[13px]' : 'text-[17px]'}`} style={{ color: 'rgba(255,255,255,0.36)' }}>{t('studio.detail.loading')}</div>;
  }

  if (stageId === 'brief') return (
    <div>
      <DetailRow label={t('studio.detail.objective')}>{text(artifact.objective)}</DetailRow>
      <DetailRow label={t('studio.detail.audience')}>{text(artifact.audience)}</DetailRow>
      <DetailRow label={t('studio.detail.coreMessage')}>{text(artifact.coreMessage)}</DetailRow>
      <DetailRow label={t('studio.detail.specification')}>{t('studio.unit.seconds', numberText(artifact.durationSeconds))} · {text(artifact.aspectRatio)} · {text(artifact.language)}</DetailRow>
    </div>
  );

  if (stageId === 'proposal') {
    const concepts = recordArray(artifact.concepts);
    const selected = concepts.find(concept => concept.id === artifact.selectedConceptId) || concepts[0];
    return (
      <div>
        <DetailRow label={t('studio.detail.selectedDirection')}>{text(selected?.title)}</DetailRow>
        <DetailRow label={t('studio.detail.openingHook')}>{text(selected?.hook)}</DetailRow>
        <DetailRow label={t('studio.detail.visualDirection')}>{text(selected?.visualDirection)}</DetailRow>
        <DetailRow label={t('studio.detail.motionLanguage')}>{text(selected?.motionLanguage)}</DetailRow>
        <DetailRow label={t('studio.detail.rationale')}>{text(artifact.rationale)}</DetailRow>
      </div>
    );
  }

  if (stageId === 'script') return <TimedItems items={recordArray(artifact.sections)} kind="script" />;

  if (stageId === 'storyboard') return (
    <div>
      <DetailRow label={t('studio.detail.artDirection')}>{text(artifact.artDirection)}</DetailRow>
      <DetailRow label={t('studio.detail.layoutConstraints')}>{text(artifact.layoutContract)}</DetailRow>
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
      <DetailRow label={t('studio.detail.runtime')}>{text(artifact.runtime)} · {text(artifact.mode)}</DetailRow>
      <DetailRow label={t('studio.detail.frameSpecification')}>{numberText(artifact.width)}×{numberText(artifact.height)} · {numberText(artifact.fps)} FPS · {t('studio.unit.seconds', numberText(artifact.durationSeconds))}</DetailRow>
      <DetailRow label={t('studio.detail.designSource')}>{text(artifact.designPath)}</DetailRow>
      <DetailRow label={t('studio.detail.editable')}>{artifact.editable ? t('studio.detail.yes') : t('studio.detail.no')}</DetailRow>
    </div>
  );

  if (stageId === 'review') {
    const technical = isRecord(artifact.technical) ? artifact.technical : {};
    const visual = isRecord(artifact.visual) ? artifact.visual : {};
    const audio = isRecord(artifact.audio) ? artifact.audio : {};
    const hasMeasuredLoudness = typeof audio.integratedLufs === 'number' && typeof audio.truePeakDbfs === 'number';
    return (
      <div>
        <DetailRow label={t('studio.detail.conclusion')}>{reviewStatusLabel(t, artifact.status)}</DetailRow>
        <DetailRow label={t('studio.detail.technicalCheck')}>{text(technical.resolution)} · {numberText(technical.fps)} FPS · {technical.hasAudio ? t('studio.detail.hasAudio') : t('studio.detail.noAudio')}</DetailRow>
        <DetailRow label={t('studio.detail.visualCheck')}>{t('studio.detail.framesSampled', numberText(visual.framesSampled))} · {visual.blackFramesDetected ? t('studio.detail.blackFramesFound') : t('studio.detail.noBlackFrames')} · {visual.overlapDetected ? t('studio.detail.overlapFound') : t('studio.detail.noOverlap')}</DetailRow>
        <DetailRow label={t('studio.detail.audioCheck')}>
          {hasMeasuredLoudness
            ? `${numberText(audio.integratedLufs)} LUFS · True Peak ${numberText(audio.truePeakDbfs)} dBFS`
            : `${t('studio.detail.loudnessNotMeasured')} · ${technical.hasAudio ? t('studio.detail.audioConfirmed') : t('studio.detail.noAudio')}`}
        </DetailRow>
      </div>
    );
  }

  if (stageId === 'delivery') return (
    <div>
      <DetailRow label={t('studio.detail.finalVideo')}>{text(artifact.outputPath)}</DetailRow>
      <DetailRow label={t('studio.detail.editableSource')}>{text(artifact.editableSourcePath)}</DetailRow>
      {typeof artifact.sha256 === 'string' && artifact.sha256 ? (
        <DetailRow label={t('studio.detail.checksum')}>{artifact.sha256}</DetailRow>
      ) : null}
      <DetailRow label={t('studio.detail.deliveredAt')}>{text(artifact.deliveredAt)}</DetailRow>
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
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    // Studio status is supplementary and should not contend with Agent startup.
    // Refresh quickly only after a Studio Run is known; an ordinary chat turn
    // can wait until after the first-token window before probing for a new run.
    const intervalMs = run ? 3500 : 10_000;
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, refresh, run]);

  return { run, artifacts };
}

export function StudioRunProgress({
  studioRun,
  isAgentActive = false,
  latestUserMessageTimestamp,
  readOnly = false,
}: {
  studioRun: StudioRunViewModel;
  isAgentActive?: boolean;
  latestUserMessageTimestamp?: number;
  readOnly?: boolean;
}) {
  const { t } = useLocale();
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

  const canDismiss = !readOnly && (isTerminal || !isAgentActive);

  const dismiss = () => {
    window.sessionStorage.setItem(dismissalKey(run.runId), 'true');
    setExpanded(false);
    setDismissedRunId(run.runId);
  };

  const currentLabel = run.currentStage ? stageLabel(t, run.currentStage) : null;
  return (
    <section data-testid="studio-run-progress" className="relative px-1 pb-2.5">
      {expanded && (
        <div data-testid="studio-run-progress-table" className="mb-3 max-h-[38vh] overflow-y-auto border-b border-white/[0.07]">
          {run.stages.map((stage, index) => {
            const visualStatus: StageStatus = stage.id === run.currentStage && run.status === 'running' && stage.status === 'pending'
              ? 'in_progress'
              : stage.status;
            const artifact = stage.artifactPath ? artifacts[stage.artifactPath] : undefined;
            const preview = artifactPreview(t, stage.id, artifact);
            return (
              <div key={stage.id} className="grid grid-cols-[20px_1fr_auto] gap-2 py-2.5 border-t border-white/[0.055] first:border-t-0">
                <span className="text-[9px] tabular-nums pt-0.5" style={{ color: 'rgba(255,255,255,0.24)' }}>{index + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor(visualStatus) }} />
                    <span className="text-[11px]" style={{ color: visualStatus === 'pending' ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.76)' }}>{stageLabel(t, stage.id)}</span>
                  </div>
                  {preview && <div className="mt-1 pl-3.5 text-[9px] truncate" style={{ color: 'rgba(255,255,255,0.32)' }}>{preview}</div>}
                </div>
                <span className="text-[9px] pt-0.5" style={{ color: statusColor(visualStatus) }}>{statusLabel(t, visualStatus)}</span>
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
        aria-label={t('studio.progress.aria')}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'rgba(255,255,255,0.52)', letterSpacing: 0 }}>Studio Run</span>
          <span className="text-[10px] truncate flex-1" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {currentLabel ? t('studio.progress.current', currentLabel) : run.status === 'completed' ? t('studio.progress.completed', run.title) : run.title}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: run.status === 'completed' ? '#e879f9' : 'rgba(255,255,255,0.42)' }}>{completed}/{run.stages.length}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease' }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <div className="grid grid-cols-8 gap-1.5" aria-label={t('studio.progress.aria')}>
          {run.stages.map(stage => {
            const visualStatus: StageStatus = stage.id === run.currentStage && run.status === 'running' && stage.status === 'pending'
              ? 'in_progress'
              : stage.status;
            return (
              <div key={stage.id} className="min-w-0" title={`${stageLabel(t, stage.id)}: ${statusLabel(t, visualStatus)}`}>
                <div className="h-1 rounded-full mb-1.5" style={{ background: statusColor(visualStatus) }} />
                <div className="text-[8px] truncate text-center" style={{ color: visualStatus === 'pending' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.48)' }}>
                  {stageLabel(t, stage.id, 'short')}
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
          aria-label={t('studio.progress.dismiss')}
          title={t('studio.progress.dismiss')}
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
  const { t } = useLocale();
  const preview = artifactPreview(t, stage.id, artifact);
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
          <span className={`${isPanel ? 'text-[16px]' : 'text-[20px]'} font-medium`} style={{ color: 'rgba(255,255,255,0.86)' }}>{stageLabel(t, stage.id)}</span>
          <span className={isPanel ? 'text-[10px]' : 'text-[12px]'} style={{ color: statusColor(status) }}>{statusLabel(t, status)}</span>
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
          <div className={`mt-1.5 pl-[18px] ${isPanel ? 'text-[14px]' : 'text-[18px]'}`} style={{ color: 'rgba(255,255,255,0.5)' }}>{t('studio.stage.generating')}</div>
        )}
      </button>
      {expanded && (
        <div className="mt-3 pl-[18px] pr-1">
          <ArtifactDetail stageId={stage.id} artifact={artifact} />
          {stage.artifactPath && onViewArtifact && (
            <button
              type="button"
              onClick={() => onViewArtifact?.(stage.artifactPath!)}
              className={`mt-3 inline-flex items-center gap-1.5 ${isPanel ? 'text-[11px]' : 'text-[14px]'} active:opacity-60`}
              style={{ color: 'rgba(232,121,249,0.7)' }}
              aria-label={t('studio.source.openAria', stageLabel(t, stage.id))}
            >
              {t('studio.source.open')}
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
