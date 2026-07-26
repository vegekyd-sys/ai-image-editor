import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '@/lib/i18n';
import { StudioRunProgress, StudioRunStageCard, type StudioRunSummary } from '@/components/StudioRunDock';
import type { Locale } from '@/lib/locales';

const briefStage = {
  id: 'brief',
  status: 'in_progress' as const,
  artifactVersion: 1,
  artifactPath: 'studio-runs/run-1/artifacts/brief.v1.json',
  artifactCreatedAt: '2026-07-26T01:00:00.000Z',
  stageUpdatedAt: '2026-07-26T01:00:00.000Z',
};

const run: StudioRunSummary = {
  runId: 'run-1',
  title: 'Product launch',
  status: 'running',
  currentStage: 'brief',
  approvalPolicy: 'auto',
  stages: [briefStage],
  updatedAt: '2026-07-26T01:00:00.000Z',
};

const briefArtifact = {
  objective: 'Keep generated artifact content unchanged',
  audience: 'Creators',
  coreMessage: 'Ship faster',
  durationSeconds: 30,
  aspectRatio: '16:9',
  language: 'English',
};

function renderForLocale(locale: Locale) {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <StudioRunProgress
        studioRun={{
          run,
          artifacts: { [briefStage.artifactPath]: briefArtifact },
        }}
        isAgentActive
      />
      <StudioRunStageCard
        stage={briefStage}
        status="in_progress"
        artifact={briefArtifact}
        ordinal={1}
        total={8}
        isPanel
      />
    </LocaleProvider>,
  );
}

function renderScriptForLocale(locale: Locale) {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <StudioRunStageCard
        stage={{
          ...briefStage,
          id: 'script',
          artifactPath: 'studio-runs/run-1/artifacts/script.v1.json',
        }}
        status="completed"
        artifact={{
          totalDurationSeconds: 5,
          sections: [{
            id: 'section-1',
            startSeconds: 0,
            endSeconds: 5,
            narration: 'Keep artifact copy unchanged',
            onScreenText: ['Launch'],
          }],
        }}
        ordinal={3}
        total={8}
        isPanel
      />
    </LocaleProvider>,
  );
}

describe('Studio Run i18n wiring', () => {
  it.each([
    ['zh', ['正在进行：创作简报', '进行中', '目标']],
    ['zh-Hant', ['正在進行：創作簡報', '進行中', '目標']],
    ['ja', ['進行中：制作概要', '進行中', '目的']],
    ['en', ['In progress: Creative brief', 'In progress', 'Objective']],
  ] as const)('renders product chrome in %s', (locale, expectedText) => {
    const html = renderForLocale(locale);
    for (const text of expectedText) expect(html).toContain(text);
    expect(html).toContain('Keep generated artifact content unchanged');
  });

  it('uses locale-aware punctuation around generated content', () => {
    expect(renderScriptForLocale('en')).toContain('On-screen text: Launch');
    expect(renderScriptForLocale('en')).not.toContain('On-screen text：');
    expect(renderScriptForLocale('zh')).toContain('屏幕文字：Launch');
    expect(renderScriptForLocale('ja')).toContain('画面テキスト：Launch');
  });
});
