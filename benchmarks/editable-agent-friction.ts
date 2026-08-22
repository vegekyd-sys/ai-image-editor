import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import {
  createAgentModelRuntime,
  getAgentProviderOptions,
} from '../src/lib/agent-model-runtime';

interface FrictionScenario {
  id: string;
  expectedTool: 'publish_draft' | 'write_file';
  prompt: string;
  editableAdvisory: boolean;
}

interface FrictionRun {
  scenario: string;
  round: number;
  expectedTool: string;
  selectedTool: string | null;
  passed: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

const scenarios: FrictionScenario[] = [
  {
    id: 'ready-clean',
    expectedTool: 'publish_draft',
    editableAdvisory: false,
    prompt: `Visual QA passed. compositionWorkspace.status is "ready". blocking is []. advisories is []. The user should receive the editable composition. Choose the next tool.`,
  },
  {
    id: 'ready-editable-coverage-advisory',
    expectedTool: 'publish_draft',
    editableAdvisory: true,
    prompt: `Visual QA passed. compositionWorkspace.status is "ready". blocking is []. advisories is ["Editable coverage incomplete: one decorative label remains non-editable."]. The reviewed composition is visually correct. Choose the next tool.`,
  },
  {
    id: 'ready-stale-field-omitted',
    expectedTool: 'publish_draft',
    editableAdvisory: true,
    prompt: `Visual QA passed. compositionWorkspace.status is "ready". blocking is []. advisories is ["Stale editable field orphanText was omitted; keep the rendered composition unchanged."]. All proven media and text fields remain editable. Choose the next tool.`,
  },
  {
    id: 'blocking-syntax-control',
    expectedTool: 'write_file',
    editableAdvisory: false,
    prompt: `Visual QA cannot run. compositionWorkspace.status is "blocked". blocking is ["Composition compile failed: Unexpected token at line 42"]. advisories is []. Choose the next tool.`,
  },
];

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function escaped(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function main() {
  loadEnv({ path: process.env.MAKARON_ENV_FILE || '.env.local', quiet: true });
  const rounds = Math.max(1, Number(process.env.EDITABLE_AGENT_BENCHMARK_ROUNDS ?? 3));
  const runtime = createAgentModelRuntime('auto', 'editable-agent-friction-benchmark');
  const runs: FrictionRun[] = [];
  const policy = `You are Makaron's production video Agent choosing exactly one next tool after receiving a Harness result.

Rules:
- If visual QA passed, status is ready, and blocking is empty, call publish_draft exactly once.
- Editable coverage and stale-field advisories are fail-soft. Never rewrite visual code, add a compatibility shim, or add manual data-editable markers merely to clear them.
- If a real compile/render blocker exists, call write_file exactly once to repair it.
- Do not answer with prose. Call exactly one provided tool.`;

  for (const scenario of scenarios) {
    for (let round = 1; round <= rounds; round++) {
      const startedAt = performance.now();
      const result = await generateText({
        model: runtime.model,
        system: policy,
        prompt: scenario.prompt,
        tools: {
          publish_draft: tool({
            description: 'Publish the already-reviewed ready composition without rewriting it.',
            inputSchema: z.object({ design_path: z.string() }),
            execute: async () => ({ success: true }),
          }),
          write_file: tool({
            description: 'Repair a real blocking composition defect before publication.',
            inputSchema: z.object({ reason: z.string() }),
            execute: async () => ({ success: true }),
          }),
        },
        toolChoice: 'required',
        stopWhen: stepCountIs(1),
        providerOptions: getAgentProviderOptions(runtime),
      });
      const selectedTool = result.toolCalls[0]?.toolName ?? null;
      runs.push({
        scenario: scenario.id,
        round,
        expectedTool: scenario.expectedTool,
        selectedTool,
        passed: selectedTool === scenario.expectedTool,
        latencyMs: Number((performance.now() - startedAt).toFixed(1)),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      });
    }
  }

  const readyRuns = runs.filter(run => run.expectedTool === 'publish_draft');
  const advisoryScenarioIds = new Set(
    scenarios.filter(scenario => scenario.editableAdvisory).map(scenario => scenario.id),
  );
  const advisoryRuns = runs.filter(run => advisoryScenarioIds.has(run.scenario));
  const blockerRuns = runs.filter(run => run.expectedTool === 'write_file');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: runtime.spec.id,
    provider: runtime.spec.provider,
    rounds,
    summary: {
      passed: runs.every(run => run.passed),
      decisions: runs.length,
      correctDecisions: runs.filter(run => run.passed).length,
      readyFirstPublishRate: readyRuns.filter(run => run.passed).length / readyRuns.length,
      editableAdvisoryRewriteRate: advisoryRuns.filter(run => run.selectedTool === 'write_file').length / advisoryRuns.length,
      blockerRepairRate: blockerRuns.filter(run => run.passed).length / blockerRuns.length,
      medianLatencyMs: percentile(runs.map(run => run.latencyMs), 0.5),
      p95LatencyMs: percentile(runs.map(run => run.latencyMs), 0.95),
      totalInputTokens: runs.reduce((total, run) => total + run.inputTokens, 0),
      totalOutputTokens: runs.reduce((total, run) => total + run.outputTokens, 0),
    },
    runs,
  };

  const outputDirArg = process.argv.find(argument => argument.startsWith('--output='));
  const outputDir = path.resolve(
    outputDirArg?.slice('--output='.length)
      || path.join('artifacts', 'editable-harness-benchmark'),
  );
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'agent-friction-report.json');
  const htmlPath = path.join(outputDir, 'agent-friction-report.html');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const rows = runs.map(run => `<tr><td>${escaped(run.scenario)}</td><td>${run.round}</td><td>${escaped(run.expectedTool)}</td><td>${escaped(run.selectedTool)}</td><td>${run.passed ? 'PASS' : 'FAIL'}</td><td>${run.latencyMs} ms</td></tr>`).join('');
  writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>Editable Agent Friction Benchmark</title><style>body{font-family:system-ui;background:#090b10;color:#eef1f7;padding:36px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #293142;text-align:left}.pass{color:#39d98a}.fail{color:#ff5c77}</style></head><body><h1>Editable Agent Friction Benchmark</h1><p class="${report.summary.passed ? 'pass' : 'fail'}">${report.summary.passed ? 'PASS' : 'FAIL'} · ${escaped(report.model)} · ${runs.length} decisions</p><ul><li>Ready first-publish rate: ${(report.summary.readyFirstPublishRate * 100).toFixed(1)}%</li><li>Editable-advisory rewrite rate: ${(report.summary.editableAdvisoryRewriteRate * 100).toFixed(1)}%</li><li>Real-blocker repair rate: ${(report.summary.blockerRepairRate * 100).toFixed(1)}%</li><li>Median latency: ${report.summary.medianLatencyMs} ms</li></ul><table><thead><tr><th>Scenario</th><th>Round</th><th>Expected</th><th>Selected</th><th>Result</th><th>Latency</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);

  // Keep the exact policy visible in the report directory for audit without
  // copying the full production prompt or any environment configuration.
  const productionPrompt = readFileSync(
    path.join(process.cwd(), 'src/lib/prompts/remotion-composition.md'),
    'utf8',
  );
  if (!productionPrompt.includes('Editable coverage is opportunistic and fail-soft.')) {
    throw new Error('Production Remotion prompt no longer contains the fail-soft editable policy.');
  }

  console.log(JSON.stringify({ ...report.summary, model: report.model, output: { jsonPath, htmlPath } }, null, 2));
  if (!report.summary.passed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
