import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { transform as sucraseTransform } from 'sucrase';
import { validateDesignReport, type DesignResult } from '../src/lib/design-harness';
import { createEditableReactRuntime } from '../src/lib/editor/editable-react-runtime';
import {
  buildRemotionEvaluatorBody,
  normalizeRemotionScopeDeclarations,
} from '../src/lib/remotion-code-normalization';
import type { EditableField, EditableType } from '../src/types';
import type {
  EditableBenchmarkCase,
  EditableBenchmarkExpectedField,
} from './editable-harness-corpus';

export interface EditableMutationResult {
  id: string;
  type: EditableType;
  passed: boolean;
  ownHostChanged: boolean;
  changedEditableIds: string[];
  changedMediaIndexes: number[];
  reason?: string;
}

export interface EditableBenchmarkCaseResult {
  id: string;
  label: string;
  pattern: string;
  passed: boolean;
  publishableFirstPass: boolean;
  idempotent: boolean;
  expectedRequired: number;
  discoveredRequired: number;
  expectedOptional: number;
  discoveredOptional: number;
  expectedMutationChecks: number;
  expectedByType: Record<EditableType, number>;
  discoveredByType: Record<EditableType, number>;
  missingRequired: string[];
  unexpected: string[];
  blocking: string[];
  advisories: string[];
  editableForcedRewriteCount: number;
  mutationResults: EditableMutationResult[];
  sourceIsolationPassed: boolean;
  compilerMs: number;
}

export interface EditableBenchmarkThresholds {
  weightedCoverage: number;
  textCoverage: number;
  imageCoverage: number;
  videoCoverage: number;
  sourceIsolation: number;
  firstPassPublishable: number;
  idempotent: number;
  maxEditableForcedRewrites: number;
}

export interface EditableBenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  thresholds: EditableBenchmarkThresholds;
  summary: {
    passed: boolean;
    cases: number;
    passedCases: number;
    expectedRequired: number;
    discoveredRequired: number;
    expectedOptional: number;
    discoveredOptional: number;
    coverageByType: Record<EditableType, number>;
    weightedCoverage: number;
    sourceIsolation: number;
    firstPassPublishable: number;
    idempotent: number;
    editableForcedRewrites: number;
    advisories: number;
    gates: Record<string, boolean>;
  };
  cases: EditableBenchmarkCaseResult[];
}

export const DEFAULT_EDITABLE_BENCHMARK_THRESHOLDS: EditableBenchmarkThresholds = {
  weightedCoverage: 0.9,
  textCoverage: 0.9,
  imageCoverage: 1,
  videoCoverage: 1,
  sourceIsolation: 1,
  firstPassPublishable: 1,
  idempotent: 1,
  maxEditableForcedRewrites: 0,
};

const EDITABLE_DIAGNOSTIC = /editable|data-editable|prop key|measurable|trimBefore|trimAfter/i;

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function fieldWeight(type: EditableType): number {
  return type === 'text' ? 1 : 3;
}

function componentName(code: string): string {
  const names = [
    ...Array.from(code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), match => match[1]),
    ...Array.from(
      code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
      match => match[1],
    ),
  ];
  for (const preferred of ['Composition', 'Design', 'App', 'Main']) {
    if (names.includes(preferred)) return preferred;
  }
  return names.at(-1) ?? 'Composition';
}

/** Lightweight Node evaluator: exercise the production editable React ABI without loading browser Remotion media. */
function compileBenchmarkComponent(
  code: string,
): React.ComponentType<Record<string, unknown>> | null {
  try {
    const normalized = normalizeRemotionScopeDeclarations(code);
    const { code: compiled } = sucraseTransform(normalized, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
    });
    const runtime = createEditableReactRuntime(React, 'video');
    const scope = {
      React: runtime.React,
      Video: 'video',
      OffthreadVideo: 'video',
      Img: 'img',
      Loop: ({ children }: { children?: React.ReactNode }) => children,
    };
    const authoredModule = { exports: {} as Record<string, unknown> };
    const factory = new Function(
      '__scope',
      'module',
      'exports',
      'require',
      buildRemotionEvaluatorBody(compiled, componentName(normalized)),
    );
    const component = factory(
      scope,
      authoredModule,
      authoredModule.exports,
      (id: string) => { throw new Error(`Benchmark fixture cannot import ${id}.`); },
    ) as React.ComponentType<Record<string, unknown>> | null;
    return component ? runtime.wrap(component, 'proxy') : null;
  } catch {
    return null;
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function changedIndexes(before: string[], after: string[]): number[] {
  const length = Math.max(before.length, after.length);
  const changed: number[] = [];
  for (let index = 0; index < length; index++) {
    if (before[index] !== after[index]) changed.push(index);
  }
  return changed;
}

interface RenderSnapshot {
  editableHosts: Map<string, string[]>;
  mediaSources: string[];
}

function renderSnapshot(
  Component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
): RenderSnapshot {
  const html = renderToStaticMarkup(React.createElement(Component, props));
  const window = new Window();
  window.document.body.innerHTML = html;
  const editableHosts = new Map<string, string[]>();
  window.document.querySelectorAll('[data-editable]').forEach(element => {
    const id = element.getAttribute('data-editable');
    if (!id) return;
    const media = element.matches('video,img')
      ? element
      : element.querySelector('video,img');
    const signature = JSON.stringify({
      tag: element.tagName.toLowerCase(),
      // A media host can contain a caption sibling in a wrapper. Text changes
      // inside that wrapper do not mean the media source itself was mutated.
      text: media ? null : element.textContent,
      src: media?.getAttribute('src') ?? null,
      style: element.getAttribute('style'),
    });
    const entries = editableHosts.get(id) ?? [];
    entries.push(signature);
    editableHosts.set(id, entries);
  });
  const mediaSources = [...window.document.querySelectorAll('video,img')]
    .map(element => element.getAttribute('src') ?? '');
  window.close();
  return { editableHosts, mediaSources };
}

function mutationValue(field: EditableField): string {
  if (field.type === 'text') return `BENCHMARK_EDIT_${field.id}`;
  const extension = field.type === 'video' ? 'mp4' : 'jpg';
  return `https://benchmark.invalid/edited-${field.id}.${extension}`;
}

function mutationResult(
  field: EditableField,
  Component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  baseline: RenderSnapshot,
): EditableMutationResult {
  const nextProps = { ...props, [field.propKey]: mutationValue(field) };
  const mutated = renderSnapshot(Component, nextProps);
  const allIds = new Set([
    ...baseline.editableHosts.keys(),
    ...mutated.editableHosts.keys(),
  ]);
  const changedEditableIds = [...allIds].filter(id => (
    JSON.stringify(baseline.editableHosts.get(id) ?? [])
      !== JSON.stringify(mutated.editableHosts.get(id) ?? [])
  ));
  const ownHostChanged = changedEditableIds.includes(field.id);
  const foreignChanges = changedEditableIds.filter(id => id !== field.id);
  const changedMediaIndexes = changedIndexes(
    baseline.mediaSources,
    mutated.mediaSources,
  );
  const mediaChangeValid = field.type === 'text'
    ? changedMediaIndexes.length === 0
    : changedMediaIndexes.length === 1;
  const passed = ownHostChanged && foreignChanges.length === 0 && mediaChangeValid;
  return {
    id: field.id,
    type: field.type,
    passed,
    ownHostChanged,
    changedEditableIds,
    changedMediaIndexes,
    ...(!passed ? {
      reason: !ownHostChanged
        ? 'The editable override did not change its own rendered host.'
        : foreignChanges.length > 0
          ? `The override also changed: ${foreignChanges.join(', ')}.`
          : `Expected ${field.type === 'text' ? 0 : 1} media source change, saw ${changedMediaIndexes.length}.`,
    } : {}),
  };
}

function expectedCounts(
  expected: EditableBenchmarkExpectedField[],
  required: boolean,
): Record<EditableType, number> {
  return expected
    .filter(field => (field.required !== false) === required)
    .reduce<Record<EditableType, number>>((counts, field) => {
      counts[field.type] += 1;
      return counts;
    }, { text: 0, image: 0, video: 0 });
}

export function runEditableBenchmarkCase(
  fixture: EditableBenchmarkCase,
): EditableBenchmarkCaseResult {
  const design: DesignResult = {
    code: fixture.code,
    props: clone(fixture.props),
    editables: clone(fixture.editables),
    animation: { fps: 30, durationInSeconds: 5 },
  };
  const startedAt = performance.now();
  const report = validateDesignReport(design);
  const compilerMs = performance.now() - startedAt;
  const discovered = design.editables ?? [];
  const discoveredById = new Map(discovered.map(field => [field.id, field]));
  const required = fixture.expected.filter(field => field.required !== false);
  const expectedMutations = required.filter(field => field.mutate !== false);
  const optional = fixture.expected.filter(field => field.required === false);
  const missingRequired = required
    .filter(field => discoveredById.get(field.id)?.type !== field.type)
    .map(field => field.id);
  const discoveredRequired = required.length - missingRequired.length;
  const discoveredOptional = optional.filter(
    field => discoveredById.get(field.id)?.type === field.type,
  ).length;
  const expectedIds = new Set(fixture.expected.map(field => field.id));
  const unexpected = discovered.map(field => field.id).filter(id => !expectedIds.has(id));
  const expectedByType = expectedCounts(fixture.expected, true);
  const discoveredByType = required.reduce<Record<EditableType, number>>((counts, field) => {
    if (discoveredById.get(field.id)?.type === field.type) counts[field.type] += 1;
    return counts;
  }, { text: 0, image: 0, video: 0 });

  let mutationResults: EditableMutationResult[] = [];
  if (report.blocking.length === 0) {
    const Component = compileBenchmarkComponent(design.code);
    if (Component) {
      const baseline = renderSnapshot(Component, design.props ?? {});
      mutationResults = expectedMutations.flatMap(expected => {
        const field = discoveredById.get(expected.id);
        return field
          ? [mutationResult(field, Component, design.props ?? {}, baseline)]
          : [];
      });
    }
  }

  const persisted: DesignResult = clone(design);
  const persistedReport = validateDesignReport(persisted);
  const idempotent = persistedReport.blocking.length === 0
    && persisted.code === design.code
    && JSON.stringify(persisted.editables) === JSON.stringify(design.editables);
  const editableForcedRewriteCount = report.blocking.filter(
    diagnostic => EDITABLE_DIAGNOSTIC.test(diagnostic),
  ).length;
  const sourceIsolationPassed = mutationResults.length === expectedMutations.length
    && mutationResults.every(result => result.passed);
  const advisoryExpectationPassed = fixture.expectAdvisory
    ? report.advisories.length > 0
    : true;
  const passed = report.blocking.length === 0
    && missingRequired.length === 0
    && unexpected.length === 0
    && sourceIsolationPassed
    && idempotent
    && editableForcedRewriteCount === 0
    && advisoryExpectationPassed;

  return {
    id: fixture.id,
    label: fixture.label,
    pattern: fixture.pattern,
    passed,
    publishableFirstPass: report.blocking.length === 0,
    idempotent,
    expectedRequired: required.length,
    discoveredRequired,
    expectedOptional: optional.length,
    discoveredOptional,
    expectedMutationChecks: expectedMutations.length,
    expectedByType,
    discoveredByType,
    missingRequired,
    unexpected,
    blocking: report.blocking,
    advisories: report.advisories,
    editableForcedRewriteCount,
    mutationResults,
    sourceIsolationPassed,
    compilerMs: rounded(compilerMs),
  };
}

export function runEditableHarnessBenchmark(
  corpus: EditableBenchmarkCase[],
  thresholds = DEFAULT_EDITABLE_BENCHMARK_THRESHOLDS,
): EditableBenchmarkReport {
  const cases = corpus.map(runEditableBenchmarkCase);
  const expectedByType = cases.reduce<Record<EditableType, number>>((counts, result) => {
    counts.text += result.expectedByType.text;
    counts.image += result.expectedByType.image;
    counts.video += result.expectedByType.video;
    return counts;
  }, { text: 0, image: 0, video: 0 });
  const discoveredByType = cases.reduce<Record<EditableType, number>>((counts, result) => {
    counts.text += result.discoveredByType.text;
    counts.image += result.discoveredByType.image;
    counts.video += result.discoveredByType.video;
    return counts;
  }, { text: 0, image: 0, video: 0 });
  const coverageByType: Record<EditableType, number> = {
    text: rounded(ratio(discoveredByType.text, expectedByType.text)),
    image: rounded(ratio(discoveredByType.image, expectedByType.image)),
    video: rounded(ratio(discoveredByType.video, expectedByType.video)),
  };
  const expectedWeight = (Object.keys(expectedByType) as EditableType[])
    .reduce((total, type) => total + expectedByType[type] * fieldWeight(type), 0);
  const discoveredWeight = (Object.keys(discoveredByType) as EditableType[])
    .reduce((total, type) => total + discoveredByType[type] * fieldWeight(type), 0);
  const expectedRequired = cases.reduce((total, result) => total + result.expectedRequired, 0);
  const discoveredRequired = cases.reduce((total, result) => total + result.discoveredRequired, 0);
  const mutationChecks = cases.flatMap(result => result.mutationResults);
  const editableForcedRewrites = cases.reduce(
    (total, result) => total + result.editableForcedRewriteCount,
    0,
  );
  const weightedCoverage = rounded(ratio(discoveredWeight, expectedWeight));
  const sourceIsolation = rounded(ratio(
    mutationChecks.filter(result => result.passed).length,
    cases.reduce((total, result) => total + result.expectedMutationChecks, 0),
  ));
  const firstPassPublishable = rounded(ratio(
    cases.filter(result => result.publishableFirstPass).length,
    cases.length,
  ));
  const idempotent = rounded(ratio(
    cases.filter(result => result.idempotent).length,
    cases.length,
  ));
  const gates = {
    weightedCoverage: weightedCoverage >= thresholds.weightedCoverage,
    textCoverage: coverageByType.text >= thresholds.textCoverage,
    imageCoverage: coverageByType.image >= thresholds.imageCoverage,
    videoCoverage: coverageByType.video >= thresholds.videoCoverage,
    sourceIsolation: sourceIsolation >= thresholds.sourceIsolation,
    firstPassPublishable: firstPassPublishable >= thresholds.firstPassPublishable,
    idempotent: idempotent >= thresholds.idempotent,
    editableForcedRewrites: editableForcedRewrites <= thresholds.maxEditableForcedRewrites,
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    thresholds,
    summary: {
      passed: Object.values(gates).every(Boolean),
      cases: cases.length,
      passedCases: cases.filter(result => result.passed).length,
      expectedRequired,
      discoveredRequired,
      expectedOptional: cases.reduce((total, result) => total + result.expectedOptional, 0),
      discoveredOptional: cases.reduce((total, result) => total + result.discoveredOptional, 0),
      coverageByType,
      weightedCoverage,
      sourceIsolation,
      firstPassPublishable,
      idempotent,
      editableForcedRewrites,
      advisories: cases.reduce((total, result) => total + result.advisories.length, 0),
      gates,
    },
    cases,
  };
}
