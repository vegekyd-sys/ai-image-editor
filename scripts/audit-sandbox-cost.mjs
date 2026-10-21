// Read-only Sandbox inventory. No command execution, stopping, or snapshot changes.
import fs from 'node:fs';
import os from 'node:os';
import { Sandbox } from '@vercel/sandbox';

const projectPath = process.env.SANDBOX_AUDIT_PROJECT_PATH || process.cwd();
const config = JSON.parse(fs.readFileSync(`${projectPath}/.vercel/project.json`, 'utf8'));
const authPath = [
  `${os.homedir()}/Library/Application Support/com.vercel.cli/auth.json`,
  `${os.homedir()}/.local/share/com.vercel.cli/auth.json`,
].find(p => fs.existsSync(p));
const token = process.env.VERCEL_TOKEN || (authPath && JSON.parse(fs.readFileSync(authPath, 'utf8')).token);
if (!token) throw new Error('Vercel CLI login or VERCEL_TOKEN required');
const since = Date.parse(process.env.SANDBOX_AUDIT_SINCE || '2026-10-09T07:00:00Z');
const end = Date.now();
const rows = new Map();
let until = end;
for (let page = 0; page < 200; page++) {
  const { json } = await Sandbox.list({ token, projectId: config.projectId, teamId: config.orgId, since, until, limit: 100 });
  for (const row of json.sandboxes) rows.set(row.id, row);
  const next = json.pagination?.next;
  if (!next || next >= until || !json.sandboxes.length) break;
  until = next;
}
const sandboxes = [...rows.values()];
const groups = new Map();
for (const row of sandboxes) {
  const key = `${row.sourceSnapshotId || 'no-snapshot'}:${row.vcpus}:${row.timeout}`;
  const group = groups.get(key) || { snapshotId: row.sourceSnapshotId, vcpus: row.vcpus, memoryMiB: row.memory, timeoutMs: row.timeout, count: 0, totalDurationMs: 0, wallMemoryGBHours: 0, minuteMinimumMemoryGBHours: 0, activeCpuHours: 0, egressGB: 0, fullTimeoutCount: 0, durations: [], statuses: {} };
  const duration = row.duration ?? Math.max(0, (row.stoppedAt || end) - (row.startedAt || row.createdAt));
  group.count++;
  group.totalDurationMs += duration;
  group.durations.push(duration);
  group.wallMemoryGBHours += row.memory / 1024 * duration / 3_600_000;
  group.minuteMinimumMemoryGBHours += row.memory / 1024 * Math.max(60_000, duration) / 3_600_000;
  group.activeCpuHours += (row.activeCpuDurationMs || 0) / 3_600_000;
  group.egressGB += (row.networkTransfer?.egress || 0) / 1e9;
  if (duration >= row.timeout * .98) group.fullTimeoutCount++;
  group.statuses[row.status] = (group.statuses[row.status] || 0) + 1;
  groups.set(key, group);
}
const summary = [...groups.values()].map(g => {
  g.durations.sort((a,b) => a-b);
  const {durations, ...rest} = g;
  return {...rest, p50Seconds: durations[Math.floor(durations.length*.5)]/1000, p95Seconds: durations[Math.floor(durations.length*.95)]/1000, estimatedMemoryUSD: g.wallMemoryGBHours*.0212, estimatedMinuteMinimumMemoryUSD: g.minuteMinimumMemoryGBHours*.0212};
}).sort((a,b)=>b.wallMemoryGBHours-a.wallMemoryGBHours);
const report = { observedAt: new Date(end).toISOString(), since: new Date(since).toISOString(), project: config.projectName, count: sandboxes.length, oldest: sandboxes.length ? new Date(Math.min(...sandboxes.map(s=>s.createdAt))).toISOString() : null, caveat: 'Resource-time estimate, not an invoice; API retention, billing cutoff, minimum duration and timing may differ.', groups: summary };
fs.mkdirSync('artifacts/sandbox-cost', {recursive:true});
fs.writeFileSync('artifacts/sandbox-cost/inventory.json', JSON.stringify({report, sandboxes},null,2));
fs.writeFileSync('artifacts/sandbox-cost/summary.json', JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
