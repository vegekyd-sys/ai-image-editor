import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  buildStudioRunStagePlacements,
  StudioRunProgress,
  StudioRunStageCard,
  useStudioRun,
  type StudioRunSummary,
} from '@/components/StudioRunDock';

const root = path.resolve(__dirname, '..');
const stageStart = '2026-07-10T00:00:00.000Z';

const run: StudioRunSummary = {
  runId: 'run-1',
  title: 'Makaron One Man Studio',
  status: 'running',
  currentStage: 'script',
  approvalPolicy: 'auto',
  updatedAt: '2026-07-10T00:04:00.000Z',
  stages: [
    { id: 'brief', status: 'completed', artifactVersion: 1, artifactPath: 'project/studio-runs/run-1/artifacts/brief.v1.json', artifactCreatedAt: '2026-07-10T00:01:00.000Z', stageUpdatedAt: '2026-07-10T00:01:00.000Z' },
    { id: 'proposal', status: 'completed', artifactVersion: 1, artifactPath: 'project/studio-runs/run-1/artifacts/proposal.v1.json', artifactCreatedAt: '2026-07-10T00:03:00.000Z', stageUpdatedAt: '2026-07-10T00:03:00.000Z' },
    { id: 'script', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
    { id: 'storyboard', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
    { id: 'assets', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
    { id: 'composition', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
    { id: 'review', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
    { id: 'delivery', status: 'pending', artifactVersion: 0, stageUpdatedAt: stageStart },
  ],
};

const briefArtifact = {
  version: '1.0',
  title: 'Makaron One Man Studio',
  objective: '让创意从一句话走到可交付成片',
  audience: '独立创作者',
  coreMessage: '一个人也能拥有完整创意工作室',
  language: 'zh-CN',
  durationSeconds: 50,
  aspectRatio: '16:9',
};

function HookHarness() {
  const studioRun = useStudioRun('project', false);
  return <StudioRunProgress studioRun={studioRun} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('Studio Run CUI surfaces', () => {
  it('stays absent when the project has no Studio Run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) }));
    render(<HookHarness />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('studio-run-progress')).toBeNull();
  });

  it('places completed stages beside the chat messages that preceded them', () => {
    const placements = buildStudioRunStagePlacements([
      Date.parse('2026-07-10T00:00:30.000Z'),
      Date.parse('2026-07-10T00:02:00.000Z'),
      Date.parse('2026-07-10T00:04:30.000Z'),
    ], run);

    expect(placements.map(placement => ({
      id: placement.stage.id,
      after: placement.afterMessageIndex,
      status: placement.status,
    }))).toEqual([
      { id: 'brief', after: 0, status: 'completed' },
      { id: 'proposal', after: 1, status: 'completed' },
      { id: 'script', after: 1, status: 'in_progress' },
    ]);
  });

  it('shows readable stage content inline and keeps the artifact expandable', () => {
    const onViewArtifact = vi.fn();
    render(
      <StudioRunStageCard
        stage={run.stages[0]}
        status="completed"
        artifact={briefArtifact}
        ordinal={1}
        total={8}
        isPanel={false}
        onViewArtifact={onViewArtifact}
      />,
    );

    const card = screen.getByTestId('studio-run-stage-brief');
    expect(card.textContent).toContain('Studio Run 1/8');
    expect(card.textContent).toContain('一个人也能拥有完整创意工作室');
    expect(screen.getByText('让创意从一句话走到可交付成片')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创作简报 已完成 Studio Run 1/8' }));
    expect(screen.queryByText('让创意从一句话走到可交付成片')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /创作简报/ }));
    fireEvent.click(screen.getByLabelText('打开创作简报原始文件'));
    expect(onViewArtifact).toHaveBeenCalledWith('project/studio-runs/run-1/artifacts/brief.v1.json');
  });

  it('labels unmeasured review loudness honestly', () => {
    const reviewRun: StudioRunSummary = {
      ...run,
      currentStage: 'delivery',
      stages: run.stages.map(stage => stage.id === 'review'
        ? { ...stage, status: 'completed', artifactPath: 'project/review.json' }
        : stage),
    };
    render(
      <StudioRunStageCard
        stage={reviewRun.stages[6]}
        status="completed"
        artifact={{
          status: 'pass',
          technical: { resolution: '1280x720', fps: 30, hasAudio: true },
          visual: { framesSampled: 5, blackFramesDetected: false, overlapDetected: false },
          audio: { integratedLufs: null, truePeakDbfs: null },
        }}
        ordinal={7}
        total={8}
        isPanel={false}
      />,
    );

    expect(screen.getByText(/响度未测量/)).toBeTruthy();
    expect(screen.queryByText(/null LUFS/)).toBeNull();
  });

  it('keeps only the compact progress surface at the composer', () => {
    const source = readFileSync(path.join(root, 'src/components/AgentChatView.tsx'), 'utf8');
    const inputBar = source.indexOf('ref={inputBarRef}');
    const progress = source.indexOf('<StudioRunProgress', inputBar);
    const textarea = source.indexOf('<textarea', progress);
    expect(source).toContain('studioStagePlacements.get(idx)?.map');
    expect(source).not.toContain('<StudioRunTimeline');
    expect(inputBar).toBeGreaterThan(-1);
    expect(progress).toBeGreaterThan(inputBar);
    expect(textarea).toBeGreaterThan(progress);
  });

  it('renders a separate read-only progress dock for public viewers', () => {
    const source = readFileSync(path.join(root, 'src/components/AgentChatView.tsx'), 'utf8');
    expect(source).toContain('data-testid="studio-run-readonly-dock"');
    expect(source).toContain('readOnly && studioRun.run');
    expect(source).toContain('onViewArtifact={readOnly ? undefined : setViewingFile}');
  });

  it('expands the bottom progress bar into the complete stage table without green accents', () => {
    render(<StudioRunProgress studioRun={{ run, artifacts: { [run.stages[0].artifactPath!]: briefArtifact } }} />);

    expect(screen.queryByTestId('studio-run-progress-table')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-run-progress-toggle'));
    const table = screen.getByTestId('studio-run-progress-table');
    expect(table.textContent).toContain('创作简报');
    expect(table.textContent).toContain('交付归档');
    expect(table.textContent).toContain('进行中');

    const source = readFileSync(path.join(root, 'src/components/StudioRunDock.tsx'), 'utf8');
    expect(source).not.toContain('#34d399');
    expect(source).not.toContain('#6ee7b7');
    expect(source).not.toContain('52,211,153');
  });

  it('closes the expanded progress table on the next click anywhere', () => {
    render(<StudioRunProgress studioRun={{ run, artifacts: {} }} />);

    fireEvent.click(screen.getByTestId('studio-run-progress-toggle'));
    expect(screen.getByTestId('studio-run-progress-table')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('studio-run-progress-table')).toBeNull();

    fireEvent.click(screen.getByTestId('studio-run-progress-toggle'));
    const table = screen.getByTestId('studio-run-progress-table');
    fireEvent.pointerDown(table);
    expect(screen.queryByTestId('studio-run-progress-table')).toBeNull();
  });

  it('lets the user dismiss a stopped run and keeps that run hidden for the session', () => {
    const { rerender } = render(<StudioRunProgress studioRun={{ run, artifacts: {} }} isAgentActive={false} />);

    fireEvent.click(screen.getByTestId('studio-run-progress-dismiss'));
    expect(screen.queryByTestId('studio-run-progress')).toBeNull();

    rerender(<StudioRunProgress studioRun={{ run: { ...run }, artifacts: {} }} isAgentActive={false} />);
    expect(screen.queryByTestId('studio-run-progress')).toBeNull();
  });

  it('keeps active work visible without a manual dismiss action', () => {
    render(<StudioRunProgress studioRun={{ run, artifacts: {} }} isAgentActive />);
    expect(screen.getByTestId('studio-run-progress')).toBeTruthy();
    expect(screen.queryByTestId('studio-run-progress-dismiss')).toBeNull();
  });

  it('keeps the read-only progress visible without exposing private file actions', () => {
    render(
      <>
        <StudioRunProgress studioRun={{ run, artifacts: {} }} isAgentActive={false} readOnly />
        <StudioRunStageCard
          stage={run.stages[0]}
          status="completed"
          artifact={briefArtifact}
          ordinal={1}
          total={8}
          isPanel
        />
      </>,
    );

    expect(screen.queryByTestId('studio-run-progress-dismiss')).toBeNull();
    expect(screen.queryByLabelText('打开创作简报原始文件')).toBeNull();
    expect(screen.getByText('让创意从一句话走到可交付成片')).toBeTruthy();
  });

  it('keeps completed progress visible until a newer user request appears', () => {
    const completedRun: StudioRunSummary = {
      ...run,
      status: 'completed',
      currentStage: null,
      stages: run.stages.map(stage => ({ ...stage, status: 'completed' })),
    };
    const { rerender } = render(
      <StudioRunProgress
        studioRun={{ run: completedRun, artifacts: {} }}
        latestUserMessageTimestamp={Date.parse(completedRun.updatedAt) - 1}
      />,
    );

    expect(screen.getByText(`已完成：${run.title}`)).toBeTruthy();
    expect(screen.getByTestId('studio-run-progress-dismiss')).toBeTruthy();

    rerender(
      <StudioRunProgress
        studioRun={{ run: completedRun, artifacts: {} }}
        latestUserMessageTimestamp={Date.parse(completedRun.updatedAt) + 1}
      />,
    );
    expect(screen.queryByTestId('studio-run-progress')).toBeNull();
  });
});
