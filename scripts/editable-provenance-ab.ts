#!/usr/bin/env tsx

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { compileEditableManifest } from '../src/lib/editor/editable-manifest';
import { analyzeEditableProvenance } from '../src/lib/editor/editable-provenance';
import { compileEditableManifestWithProvenance } from '../src/lib/editor/editable-provenance-compiler';
import type { DesignPayload } from '../src/types';

export const EDITABLE_PROVENANCE_PUBLIC_CORPUS = [
  {
    projectId: '0d3a8e2d-8731-4e26-8e9d-39ff2d8cdef6',
    label: 'Racket dynamic bilingual cue map',
    cohort: 'gap',
  },
  {
    projectId: 'b2d30afe-5ac9-4c5a-b521-d5fe6f341442',
    label: 'Connector scene assembly',
    cohort: 'gap',
  },
  {
    projectId: 'b9b233ad-378a-4799-9776-3a5925f93df5',
    label: 'Captured Moment chapter map',
    cohort: 'gap',
  },
  {
    projectId: '500f638f-2702-4e78-bdd9-4972f72f76a9',
    label: 'Card Magic captions',
    cohort: 'gap',
  },
  {
    projectId: '4ec89615-f119-475d-a0d5-67cbe8f3b72d',
    label: 'Fiber process vertical explainer',
    cohort: 'gap',
  },
  {
    projectId: 'd2d75494-a7bf-488e-88c2-421f3d8cc0e1',
    label: 'Fiber manufacturing full process',
    cohort: 'gap',
  },
  {
    projectId: '97568c36-5aef-42ba-b1c1-0b8d4ce7fea5',
    label: 'Long TikTok word captions',
    cohort: 'gap',
  },
  {
    projectId: '3dbd6024-c9d2-4fe4-b53b-72b9c312a3f9',
    label: 'Racket explicit normalized control',
    cohort: 'control',
  },
  {
    projectId: '323ef939-736c-41b9-ad9c-3e8e3a09e652',
    label: 'Makaron 35s image control',
    cohort: 'control',
  },
  {
    projectId: '0208cf9d-9d57-451a-8ff6-56c6a890656b',
    label: 'Generation-first mixed media control',
    cohort: 'control',
  },
] as const;

interface ProjectRow {
  id: string;
  title: string | null;
  user_id: string;
  is_public: boolean;
}

interface SnapshotRow {
  id: string;
  project_id: string;
  design_path: string | null;
  created_at: string;
}

interface AbRow {
  projectId: string;
  title: string;
  label: string;
  cohort: string;
  snapshotId: string;
  snapshotIndex: number;
  totalSnapshots: number;
  production: {
    fields: number;
    visibleSinks: number;
    unsupported: number;
    diagnostics: number;
    ids: string[];
  };
  provenance: {
    fields: number;
    nodes: number;
    diagnostics: number;
    diagnosticMessages: string[];
    ids: string[];
  };
  added: string[];
  addedProps: string[];
  addedLiterals: string[];
  missing: string[];
  addedNodes: Array<{
    nodeId: string;
    type: string;
    bindingKeys: string[];
    component: string;
    line?: number;
    tag: string;
  }>;
}

interface BenchmarkInput {
  label: string;
  code: string;
  props: Record<string, unknown>;
  editables?: DesignPayload['editables'];
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

async function main() {
  const envPath = process.env.MAKARON_ENV_FILE;
  if (envPath) loadEnv({ path: envPath, quiet: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required. '
      + 'Set MAKARON_ENV_FILE to load them from a local env file.',
    );
  }

  // Use the anonymous client deliberately: every corpus row must be readable
  // through the same public-project RLS path as an anonymous viewer.
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids = EDITABLE_PROVENANCE_PUBLIC_CORPUS.map(entry => entry.projectId);
  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .select('id,title,user_id,is_public')
    .in('id', ids)
    .eq('is_public', true);
  if (projectError) throw projectError;
  const projects = (projectData ?? []) as ProjectRow[];
  const projectById = new Map(projects.map(project => [project.id, project]));
  const missingPublic = ids.filter(id => !projectById.has(id));
  if (missingPublic.length > 0) {
    throw new Error(`Corpus projects are no longer public: ${missingPublic.join(', ')}`);
  }

  const { data: snapshotData, error: snapshotError } = await supabase
    .from('snapshots')
    .select('id,project_id,design_path,created_at')
    .in('project_id', ids)
    .order('created_at', { ascending: false });
  if (snapshotError) throw snapshotError;
  const latestByProject = new Map<string, SnapshotRow>();
  for (const snapshot of (snapshotData ?? []) as SnapshotRow[]) {
    if (snapshot.design_path && !latestByProject.has(snapshot.project_id)) {
      latestByProject.set(snapshot.project_id, snapshot);
    }
  }

  const rows: AbRow[] = [];
  const benchmarkInputs: BenchmarkInput[] = [];
  for (const corpusEntry of EDITABLE_PROVENANCE_PUBLIC_CORPUS) {
    const project = projectById.get(corpusEntry.projectId)!;
    const snapshot = latestByProject.get(corpusEntry.projectId);
    if (!snapshot) throw new Error(`No editable snapshot for ${corpusEntry.projectId}`);
    const projectSnapshots = ((snapshotData ?? []) as SnapshotRow[])
      .filter(item => item.project_id === corpusEntry.projectId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const snapshotIndex = projectSnapshots.findIndex(item => item.id === snapshot.id) + 1;
    const storagePath = `${project.user_id}/workspace/${snapshot.design_path}`;
    const { data: blob, error: downloadError } = await supabase.storage
      .from('images')
      .download(storagePath);
    if (downloadError) throw downloadError;
    const design = JSON.parse(await blob.text()) as DesignPayload;
    if (typeof design.code !== 'string') {
      throw new Error(`Composition ${snapshot.id} has no code`);
    }
    benchmarkInputs.push({
      label: corpusEntry.label,
      code: design.code,
      props: cloneRecord(design.props ?? {}),
      editables: cloneRecord(design.editables),
    });

    const productionProps = cloneRecord(design.props ?? {});
    const production = compileEditableManifest({
      code: design.code,
      props: productionProps,
      editables: cloneRecord(design.editables),
    });
    const provenanceProps = cloneRecord(design.props ?? {});
    const enhanced = compileEditableManifestWithProvenance({
      code: design.code,
      props: provenanceProps,
      editables: cloneRecord(design.editables),
    });
    const provenance = analyzeEditableProvenance({
      code: enhanced.code,
      props: provenanceProps,
      editables: enhanced.editables,
    });
    const productionIds = production.editables.map(field => field.propKey);
    const provenanceIds = enhanced.editables.map(field => field.propKey);
    const productionSet = new Set(productionIds);
    const provenanceSet = new Set(provenanceIds);
    const added = provenanceIds.filter(id => !productionSet.has(id)).sort();
    const missing = productionIds.filter(id => !provenanceSet.has(id)).sort();
    const addedSet = new Set(added);
    const provenanceByPropKey = new Map(
      enhanced.editables.map(field => [field.propKey, field]),
    );
    const addedLiterals = added.filter(id => provenanceByPropKey.get(id)?.source === 'literal');
    const addedProps = added.filter(id => provenanceByPropKey.get(id)?.source !== 'literal');

    rows.push({
      projectId: corpusEntry.projectId,
      title: project.title ?? 'Untitled',
      label: corpusEntry.label,
      cohort: corpusEntry.cohort,
      snapshotId: snapshot.id,
      snapshotIndex,
      totalSnapshots: projectSnapshots.length,
      production: {
        fields: production.editables.length,
        visibleSinks: production.coverage.visibleSinks,
        unsupported: production.coverage.unsupported.length,
        diagnostics: production.diagnostics.length,
        ids: productionIds,
      },
      provenance: {
        fields: enhanced.editables.length,
        nodes: provenance.nodes.length,
        diagnostics: enhanced.diagnostics.length,
        diagnosticMessages: enhanced.diagnostics,
        ids: provenanceIds,
      },
      added,
      addedProps,
      addedLiterals,
      missing,
      addedNodes: provenance.nodes
        .filter(node => node.bindingKeys.some(key => addedSet.has(key)))
        .map(node => ({
          nodeId: node.nodeId,
          type: node.type,
          bindingKeys: node.bindingKeys,
          component: node.component,
          ...(node.line ? { line: node.line } : {}),
          tag: node.tag,
        })),
    });
  }

  if (process.argv.includes('--benchmark')) {
    const iterations = Math.max(5, Number(process.env.BENCH_ITERATIONS ?? 30));
    const benchmarkRows = benchmarkInputs.map(input => {
      compileEditableManifest({
        code: input.code,
        props: cloneRecord(input.props),
        editables: cloneRecord(input.editables),
      });
      compileEditableManifestWithProvenance({
        code: input.code,
        props: cloneRecord(input.props),
        editables: cloneRecord(input.editables),
      });

      const productionTimes: number[] = [];
      const provenanceTimes: number[] = [];
      for (let index = 0; index < iterations; index++) {
        const productionProps = cloneRecord(input.props);
        const provenanceProps = cloneRecord(input.props);
        const runProduction = () => {
          const startedAt = performance.now();
          compileEditableManifest({
            code: input.code,
            props: productionProps,
            editables: cloneRecord(input.editables),
          });
          productionTimes.push(performance.now() - startedAt);
        };
        const runProvenance = () => {
          const startedAt = performance.now();
          compileEditableManifestWithProvenance({
            code: input.code,
            props: provenanceProps,
            editables: cloneRecord(input.editables),
          });
          provenanceTimes.push(performance.now() - startedAt);
        };
        if (index % 2 === 0) {
          runProduction();
          runProvenance();
        } else {
          runProvenance();
          runProduction();
        }
      }

      const productionProps = cloneRecord(input.props);
      const provenanceProps = cloneRecord(input.props);
      const production = compileEditableManifest({
        code: input.code,
        props: productionProps,
        editables: cloneRecord(input.editables),
      });
      const provenance = compileEditableManifestWithProvenance({
        code: input.code,
        props: provenanceProps,
        editables: cloneRecord(input.editables),
      });
      return {
        label: input.label,
        productionMedianMs: percentile(productionTimes, 0.5),
        provenanceMedianMs: percentile(provenanceTimes, 0.5),
        productionP95Ms: percentile(productionTimes, 0.95),
        provenanceP95Ms: percentile(provenanceTimes, 0.95),
        codeBytesDelta: Buffer.byteLength(provenance.code) - Buffer.byteLength(production.code),
        propsBytesDelta: jsonBytes(provenanceProps) - jsonBytes(productionProps),
        fieldsDelta: provenance.editables.length - production.editables.length,
      };
    });
    console.log(JSON.stringify({ iterations, rows: benchmarkRows }, null, 2));
    return;
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log('| Project | Cohort | Production fields | Unsupported | Provenance fields | Added props | Literal candidates | Missing |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  rows.forEach(row => {
    console.log(
      `| [${row.label}](https://www.makaron.app/projects/${row.projectId}) `
      + `| ${row.cohort} | ${row.production.fields} | ${row.production.unsupported} `
      + `| ${row.provenance.fields} | ${row.addedProps.length} `
      + `| ${row.addedLiterals.length} | ${row.missing.length} |`,
    );
  });
  const totals = rows.reduce((result, row) => ({
    production: result.production + row.production.fields,
    unsupported: result.unsupported + row.production.unsupported,
    provenance: result.provenance + row.provenance.fields,
    addedProps: result.addedProps + row.addedProps.length,
    addedLiterals: result.addedLiterals + row.addedLiterals.length,
    missing: result.missing + row.missing.length,
  }), {
    production: 0,
    unsupported: 0,
    provenance: 0,
    addedProps: 0,
    addedLiterals: 0,
    missing: 0,
  });
  console.log(
    `| **Total** |  | **${totals.production}** | **${totals.unsupported}** `
    + `| **${totals.provenance}** | **${totals.addedProps}** `
    + `| **${totals.addedLiterals}** | **${totals.missing}** |`,
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
