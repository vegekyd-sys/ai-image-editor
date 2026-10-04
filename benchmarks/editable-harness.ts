import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EDITABLE_HARNESS_BENCHMARK_CORPUS } from './editable-harness-corpus';
import { runEditableHarnessBenchmark, type EditableBenchmarkReport } from './editable-harness-core';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escaped(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function reportHtml(report: EditableBenchmarkReport): string {
  const rows = report.cases.map(result => `
    <tr class="${result.passed ? 'pass' : 'fail'}">
      <td><strong>${escaped(result.label)}</strong><br><small>${escaped(result.pattern)}</small></td>
      <td>${result.discoveredRequired}/${result.expectedRequired}</td>
      <td>${result.sourceIsolationPassed ? 'PASS' : 'FAIL'}</td>
      <td>${result.publishableFirstPass ? 'PASS' : 'FAIL'}</td>
      <td>${result.idempotent ? 'PASS' : 'FAIL'}</td>
      <td>${result.editableForcedRewriteCount}</td>
      <td>${result.compilerMs.toFixed(2)} ms</td>
      <td>${escaped([
        ...result.missingRequired.map(id => `missing ${id}`),
        ...result.unexpected.map(id => `unexpected ${id}`),
        ...result.mutationResults.filter(item => !item.passed).map(item => `${item.id}: ${item.reason}`),
        ...result.blocking,
      ].join(' | ') || '—')}</td>
    </tr>`).join('');
  const gates = Object.entries(report.summary.gates).map(([name, passed]) => (
    `<li class="${passed ? 'pass-text' : 'fail-text'}">${escaped(name)}: ${passed ? 'PASS' : 'FAIL'}</li>`
  )).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Editable Harness Benchmark</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 36px; background: #090b10; color: #eef1f7; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .muted, small { color: #929bad; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 28px 0; }
    .card { padding: 18px; background: #121722; border: 1px solid #252d3b; border-radius: 14px; }
    .card strong { display: block; margin-top: 8px; font-size: 25px; }
    table { width: 100%; border-collapse: collapse; background: #10141d; border-radius: 14px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #252d3b; vertical-align: top; }
    th { color: #aeb7c8; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
    tr.pass td:first-child { border-left: 4px solid #39d98a; }
    tr.fail td:first-child { border-left: 4px solid #ff5c77; }
    .pass-text { color: #39d98a; }
    .fail-text { color: #ff5c77; }
    code { color: #f3b6ff; }
  </style>
</head>
<body>
  <h1>Editable Harness Benchmark</h1>
  <div class="muted">Generated ${escaped(report.generatedAt)} · deterministic 12-pattern corpus</div>
  <div class="grid">
    <div class="card">Release gates<strong class="${report.summary.passed ? 'pass-text' : 'fail-text'}">${report.summary.passed ? 'PASS' : 'FAIL'}</strong></div>
    <div class="card">Weighted coverage<strong>${pct(report.summary.weightedCoverage)}</strong></div>
    <div class="card">Text / image / video<strong>${pct(report.summary.coverageByType.text)} / ${pct(report.summary.coverageByType.image)} / ${pct(report.summary.coverageByType.video)}</strong></div>
    <div class="card">Source isolation<strong>${pct(report.summary.sourceIsolation)}</strong></div>
    <div class="card">First-pass publishable<strong>${pct(report.summary.firstPassPublishable)}</strong></div>
    <div class="card">Editable-forced rewrites<strong>${report.summary.editableForcedRewrites}</strong></div>
  </div>
  <h2>Release gates</h2>
  <ul>${gates}</ul>
  <h2>Cases</h2>
  <table>
    <thead><tr><th>Case</th><th>Coverage</th><th>Isolation</th><th>Publish</th><th>2nd pass</th><th>Forced rewrites</th><th>Compiler</th><th>Failures</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function main() {
  const report = runEditableHarnessBenchmark(EDITABLE_HARNESS_BENCHMARK_CORPUS);
  const outputDirArg = process.argv.find(argument => argument.startsWith('--output='));
  const outputDir = path.resolve(
    outputDirArg?.slice('--output='.length)
      || path.join('artifacts', 'editable-harness-benchmark'),
  );
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'report.json');
  const htmlPath = path.join(outputDir, 'report.html');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(htmlPath, reportHtml(report));

  console.log(JSON.stringify({
    ...report.summary,
    output: { jsonPath, htmlPath },
    failedCases: report.cases.filter(result => !result.passed).map(result => ({
      id: result.id,
      missing: result.missingRequired,
      unexpected: result.unexpected,
      mutationFailures: result.mutationResults
        .filter(item => !item.passed)
        .map(item => ({ id: item.id, reason: item.reason })),
      blocking: result.blocking,
    })),
  }, null, 2));
  if (!report.summary.passed) process.exitCode = 1;
}

main();
