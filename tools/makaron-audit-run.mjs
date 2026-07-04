#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    if (process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = {
    projectId: '',
    runId: '',
    json: false,
    limit: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--project' || arg === '--project-id') {
      args.projectId = next || '';
      i += 1;
    } else if (arg === '--run' || arg === '--run-id') {
      args.runId = next || '';
      i += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--limit') {
      args.limit = Number(next || args.limit);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (!args.projectId && /^[0-9a-f-]{36}$/i.test(arg)) {
      args.projectId = arg;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Makaron agent run audit

Usage:
  npm run audit:run -- --project <project-id>
  npm run audit:run -- --run <run-id>
  npm run audit:run -- --project <project-id> --json

Options:
  --project, --project-id   Audit all recent runs for a project
  --run, --run-id           Audit one run
  --limit <n>               Max runs when using --project (default: 20)
  --json                    Print raw JSON report
`);
}

function seconds(start, end) {
  if (!start || !end) return null;
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function compact(value, max = 140) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function eventText(event) {
  const data = event.data || {};
  return data.content || data.text || data.message || data.error || data.status || data.name || '';
}

function eventName(event) {
  const data = event.data || {};
  return data.name || data.tool || data.toolName || data.status || data.snapshotId || '';
}

function toolDurations(events) {
  const pending = new Map();
  const calls = [];
  for (const event of events) {
    const name = eventName(event);
    if (event.type === 'tool_call' && name) {
      if (!pending.has(name)) pending.set(name, []);
      pending.get(name).push(event);
    }
    if (event.type === 'tool_result' && name) {
      const bucket = pending.get(name);
      const started = bucket?.shift();
      if (!started) continue;
      calls.push({
        tool: name,
        start: started.created_at,
        end: event.created_at,
        sec: seconds(started.created_at, event.created_at),
      });
    }
  }
  return calls;
}

function summarizeTools(calls) {
  const byTool = {};
  for (const call of calls) {
    if (!call.tool || call.sec == null) continue;
    const item = byTool[call.tool] || { count: 0, totalSec: 0, maxSec: 0 };
    item.count += 1;
    item.totalSec += call.sec;
    item.maxSec = Math.max(item.maxSec, call.sec);
    byTool[call.tool] = item;
  }
  for (const item of Object.values(byTool)) {
    item.totalSec = Math.round(item.totalSec * 10) / 10;
    item.maxSec = Math.round(item.maxSec * 10) / 10;
  }
  return byTool;
}

function gaps(events) {
  const rows = [];
  for (let i = 1; i < events.length; i += 1) {
    const sec = seconds(events[i - 1].created_at, events[i].created_at);
    if (sec == null || sec < 20) continue;
    rows.push({
      fromSeq: events[i - 1].seq,
      toSeq: events[i].seq,
      sec,
      previous: `${events[i - 1].type} ${compact(eventText(events[i - 1]) || eventName(events[i - 1]), 90)}`,
      next: `${events[i].type} ${compact(eventText(events[i]) || eventName(events[i]), 90)}`,
    });
  }
  return rows.sort((a, b) => b.sec - a.sec);
}

function countBy(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] || 0) + 1;
  return out;
}

function collectOmitted(toolHistory) {
  const values = [];
  for (const row of toolHistory) {
    for (const item of row.omitted || []) values.push(item);
  }
  return countBy(values);
}

function detectIssues(run, events, toolHistory, snapshots) {
  const issues = [];
  const omitted = collectOmitted(toolHistory);
  if (omitted.run_budget_exceeded) {
    issues.push(`tool history budget exceeded ${omitted.run_budget_exceeded} time(s); model likely lost useful tool context`);
  }
  const publishedCompositions = snapshots.filter(s => s.design_path && s.created_at >= run.started_at && (!run.ended_at || s.created_at <= run.ended_at));
  for (const snapshot of publishedCompositions) {
    const duration = snapshot.design?.animation?.durationInSeconds;
    if (typeof duration === 'number') {
      const promptDuration = String(run.prompt || '').match(/(\d{2,3})\s*(秒|s|sec|second)/i);
      if (promptDuration && Math.abs(duration - Number(promptDuration[1])) > 2) {
        issues.push(`duration contract drift: prompt requested ${promptDuration[1]}s, published ${duration}s (${snapshot.id})`);
      }
    }
    const editables = snapshot.design?.props?.editables;
    if (editables !== undefined && !Array.isArray(editables)) {
      issues.push(`props.editables is not an array (${snapshot.id})`);
    }
    if (editables === undefined) {
      issues.push(`props.editables missing (${snapshot.id})`);
    }
  }
  const previewCaptured = events.filter(e => e.type === 'preview_frame_captured').length;
  const previewCalls = events.filter(e => e.type === 'tool_call' && eventName(e) === 'preview_frame').length;
  if (previewCalls && !previewCaptured) {
    issues.push(`preview_frame called ${previewCalls} time(s) but no preview_frame_captured event was persisted`);
  }
  return [...new Set(issues)];
}

async function readDesign(supabase, userId, designPath) {
  if (!userId || !designPath) return null;
  try {
    const storagePath = `${userId}/workspace/${designPath}`;
    const { data } = supabase.storage.from('images').getPublicUrl(storagePath);
    if (!data?.publicUrl) return null;
    const res = await fetch(`${data.publicUrl}?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function auditRun(supabase, run) {
  const [{ data: events, error: eventsError }, { data: toolHistory, error: toolsError }, { data: snapshots, error: snapshotsError }] = await Promise.all([
    supabase.from('agent_events').select('seq,type,data,created_at').eq('run_id', run.id).order('seq', { ascending: true }),
    supabase.from('agent_tool_history').select('tool_name,input_chars,output_chars,omitted,created_at,input,output').eq('run_id', run.id).order('created_at', { ascending: true }),
    supabase.from('snapshots').select('id,type,image_url,design_path,video_meta,created_at,sort_order').eq('project_id', run.project_id).order('sort_order', { ascending: true }),
  ]);
  if (eventsError) throw eventsError;
  if (toolsError) throw toolsError;
  if (snapshotsError) throw snapshotsError;

  const enrichedSnapshots = [];
  for (const snapshot of snapshots || []) {
    const design = snapshot.design_path ? await readDesign(supabase, run.user_id, snapshot.design_path) : null;
    enrichedSnapshots.push({ ...snapshot, design });
  }

  const calls = toolDurations(events || []);
  const toolHistoryChars = (toolHistory || []).reduce((acc, row) => ({
    input: acc.input + (row.input_chars || 0),
    output: acc.output + (row.output_chars || 0),
  }), { input: 0, output: 0 });
  const eventTypes = countBy((events || []).map(e => e.type));
  const toolNames = countBy((toolHistory || []).map(row => row.tool_name));
  const publishedInRun = enrichedSnapshots
    .filter(s => s.created_at >= run.started_at && (!run.ended_at || s.created_at <= run.ended_at))
    .map(s => ({
      id: s.id,
      type: s.type || (s.design_path ? 'composition' : 'image'),
      designPath: s.design_path,
      duration: s.design?.animation?.durationInSeconds ?? s.video_meta?.duration ?? null,
      editables: Array.isArray(s.design?.props?.editables) ? s.design.props.editables.length : null,
      imageUrl: s.image_url,
      createdAt: s.created_at,
    }));

  return {
    id: run.id,
    projectId: run.project_id,
    status: run.status,
    prompt: run.prompt,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    totalSec: seconds(run.started_at, run.ended_at),
    metadata: run.metadata || {},
    events: {
      total: events?.length || 0,
      byType: eventTypes,
      largestGaps: gaps(events || []).slice(0, 10),
    },
    tools: {
      callsByTool: summarizeTools(calls),
      historyRows: toolHistory?.length || 0,
      historyChars: toolHistoryChars,
      historyByTool: toolNames,
      omitted: collectOmitted(toolHistory || []),
    },
    artifacts: {
      publishedInRun,
      previewFramesCaptured: eventTypes.preview_frame_captured || 0,
      images: eventTypes.image || 0,
      renders: eventTypes.render || 0,
    },
    issues: detectIssues(run, events || [], toolHistory || [], enrichedSnapshots),
  };
}

function formatTable(rows, columns) {
  if (!rows.length) return '_none_';
  const widths = columns.map(col => Math.max(col.label.length, ...rows.map(row => String(col.value(row) ?? '').length)));
  const header = `| ${columns.map((col, i) => col.label.padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map(width => '-'.repeat(width)).join(' | ')} |`;
  const body = rows.map(row => `| ${columns.map((col, i) => String(col.value(row) ?? '').padEnd(widths[i])).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Makaron Run Audit`);
  lines.push('');
  for (const run of report.runs) {
    lines.push(`## ${run.id}`);
    lines.push('');
    lines.push(`- Project: \`${run.projectId}\``);
    lines.push(`- Status: \`${run.status}\``);
    lines.push(`- Prompt: ${run.prompt || '(empty)'}`);
    lines.push(`- Total: ${run.totalSec ?? 'running'}s`);
    lines.push(`- Events: ${run.events.total}`);
    lines.push(`- Tool history: ${run.tools.historyRows} rows, input ${run.tools.historyChars.input} chars, output ${run.tools.historyChars.output} chars`);
    lines.push('');
    lines.push(`### Tool Time`);
    lines.push(formatTable(Object.entries(run.tools.callsByTool).map(([tool, value]) => ({ tool, ...value })), [
      { label: 'tool', value: row => row.tool },
      { label: 'count', value: row => row.count },
      { label: 'totalSec', value: row => row.totalSec },
      { label: 'maxSec', value: row => row.maxSec },
    ]));
    lines.push('');
    lines.push(`### Largest Gaps`);
    lines.push(formatTable(run.events.largestGaps, [
      { label: 'sec', value: row => row.sec },
      { label: 'from', value: row => row.fromSeq },
      { label: 'to', value: row => row.toSeq },
      { label: 'previous', value: row => row.previous },
      { label: 'next', value: row => row.next },
    ]));
    lines.push('');
    lines.push(`### Artifacts`);
    lines.push(formatTable(run.artifacts.publishedInRun, [
      { label: 'id', value: row => row.id },
      { label: 'type', value: row => row.type },
      { label: 'duration', value: row => row.duration ?? '' },
      { label: 'editables', value: row => row.editables ?? '' },
      { label: 'designPath', value: row => row.designPath || '' },
    ]));
    lines.push('');
    lines.push(`### Omitted`);
    const omittedRows = Object.entries(run.tools.omitted).map(([name, count]) => ({ name, count }));
    lines.push(formatTable(omittedRows, [
      { label: 'name', value: row => row.name },
      { label: 'count', value: row => row.count },
    ]));
    lines.push('');
    lines.push(`### Issues`);
    if (run.issues.length) {
      for (const issue of run.issues) lines.push(`- ${issue}`);
    } else {
      lines.push('- none detected by current harness');
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), '.env.local'));
  loadEnvFile(path.resolve(process.cwd(), '.env'));

  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId && !args.runId) {
    printHelp();
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let query = supabase.from('agent_runs').select('*').order('started_at', { ascending: true }).limit(args.limit);
  if (args.runId) query = query.eq('id', args.runId);
  if (args.projectId) query = query.eq('project_id', args.projectId);
  const { data: runs, error } = await query;
  if (error) throw error;
  if (!runs?.length) throw new Error('No matching agent runs found');

  const report = { generatedAt: new Date().toISOString(), runs: [] };
  for (const run of runs) report.runs.push(await auditRun(supabase, run));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdown(report));
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
