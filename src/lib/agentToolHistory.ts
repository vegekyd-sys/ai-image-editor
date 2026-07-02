import type { ModelMessage } from 'ai';

export const TOOL_HISTORY_MAX_ROWS_PER_RUN = 20;
export const TOOL_HISTORY_MAX_CHARS_PER_RUN = 120_000;
export const TOOL_HISTORY_MAX_INPUT_CHARS = 6_000;
export const TOOL_HISTORY_MAX_OUTPUT_CHARS = 30_000;
export const TOOL_HISTORY_MAX_ANALYSIS_CHARS = 6_000;
export const TOOL_HISTORY_MAX_LIST_FILES = 500;

type JsonRecord = Record<string, unknown>;

export type ToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown };

export interface ToolHistoryBudget {
  rows: number;
  chars: number;
}

export interface SanitizedToolHistory {
  input: unknown;
  output: ToolResultOutput;
  omitted: string[];
  inputChars: number;
  outputChars: number;
}

export interface DbToolHistoryRow {
  created_at: string;
  run_id?: string | null;
  step: number;
  seq: number;
  tool_call_id: string;
  tool_name: string;
  input: unknown;
  output: ToolResultOutput;
}

export interface DbVisibleMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const DATA_URL_RE = /^data:(image|video|audio)\//i;
const BASE64ISH_RE = /^[A-Za-z0-9+/=\r\n]+$/;
const DANGEROUS_KEYS = new Set(['image', 'images', 'base64Data', 'data', 'buffer']);
const TRUNCATED_RUN_CODE_MARKERS = [
  /\.\.\. \(\d+ chars\)/,
  /\.\.\.\(truncated\)/,
  /\[truncated: \d+ chars omitted\]/,
  /\[code streamed separately: \d+ chars\]/,
];

function jsonChars(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return String(value).length;
  }
}

function scrubDataUrls(text: string, omitted: string[]): string {
  if (!text.includes('data:')) return text;
  return text.replace(/data:(image|video|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi, match => {
    const kind = match.slice(5, match.indexOf('/')).toLowerCase();
    omitted.push(`removed_data_url_${kind}`);
    return `[omitted ${kind} data url: ${match.length} chars]`;
  });
}

function truncateText(text: string, maxChars: number, omitted: string[], reason: string): string {
  const scrubbed = scrubDataUrls(text, omitted);
  if (scrubbed.length <= maxChars) return scrubbed;
  omitted.push(reason);
  return `${scrubbed.slice(0, maxChars)}\n\n[truncated: ${scrubbed.length - maxChars} chars omitted]`;
}

function sanitizeUnknown(value: unknown, omitted: string[], maxStringChars = TOOL_HISTORY_MAX_INPUT_CHARS): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (DATA_URL_RE.test(value)) {
      omitted.push('removed_data_url');
      return `[omitted data url: ${value.length} chars]`;
    }
    if (value.length > maxStringChars) {
      return truncateText(value, maxStringChars, omitted, 'truncated_string');
    }
    return scrubDataUrls(value, omitted);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => sanitizeUnknown(item, omitted, maxStringChars));
  }
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) {
      omitted.push('removed_buffer');
      return `[omitted buffer: ${value.length} bytes]`;
    }
    const record = value as JsonRecord;
    const out: JsonRecord = {};
    for (const [key, inner] of Object.entries(record)) {
      if (DANGEROUS_KEYS.has(key)) {
        if (key === 'base64Data') {
          omitted.push('removed_binary_payload');
          out.__omitted_payload = true;
          continue;
        }
        if (typeof inner === 'string' && !DATA_URL_RE.test(inner) && inner.length < 200 && !BASE64ISH_RE.test(inner)) {
          out[key] = inner;
        } else {
          omitted.push(key === 'image' || key === 'images' ? `removed_${key}` : 'removed_binary_payload');
          out.__omitted_payload = true;
        }
        continue;
      }
      out[key] = sanitizeUnknown(inner, omitted, maxStringChars);
    }
    return out;
  }
  return String(value);
}

function compactReadFileOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  if (output.error) return { type: 'error-text', value: String(output.error) };
  const path = typeof output.path === 'string' ? output.path : 'unknown';
  const contentType = typeof output.type === 'string'
    ? output.type
    : typeof output.contentType === 'string'
      ? output.contentType
      : typeof output.mimeType === 'string'
        ? output.mimeType
        : 'unknown';

  if (output.base64Data || String(contentType).startsWith('image/') || String(contentType).startsWith('video/') || String(contentType).startsWith('audio/')) {
    omitted.push('removed_media_file_content');
    return {
      type: 'json',
      value: {
        path,
        type: contentType,
        content: `[omitted media content from ${path}]`,
      },
    };
  }

  const content = typeof output.content === 'string' ? output.content : JSON.stringify(sanitizeUnknown(output, omitted));
  return {
    type: 'text',
    value: `[${path}]\n\n${truncateText(content, TOOL_HISTORY_MAX_OUTPUT_CHARS, omitted, 'truncated_read_file')}`,
  };
}

function compactListFilesOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  const files = Array.isArray(output.files) ? output.files : [];
  if (files.length > TOOL_HISTORY_MAX_LIST_FILES) omitted.push('truncated_list_files');
  return {
    type: 'json',
    value: {
      count: output.count ?? files.length,
      files: files.slice(0, TOOL_HISTORY_MAX_LIST_FILES).map(file => {
        const f = file as JsonRecord;
        return {
          path: f.path,
          type: f.type ?? f.contentType,
          size: f.size,
          builtIn: f.builtIn,
          url: f.url ?? f.storageUrl ?? f.workspaceUrl,
        };
      }),
    },
  };
}

function compactPreviewFrameOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  omitted.push('removed_preview_frame_pixels');
  return {
    type: 'json',
    value: {
      workspaceUrl: output.workspaceUrl,
      source: output.source,
      frame: output.frame,
      timestamp: output.timestamp,
      message: output.message,
    },
  };
}

function compactRunCodeOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  const safe = sanitizeUnknown(output, omitted, TOOL_HISTORY_MAX_ANALYSIS_CHARS) as JsonRecord;
  return {
    type: 'json',
    value: {
      type: safe.type,
      content: typeof safe.content === 'string'
        ? truncateText(safe.content, TOOL_HISTORY_MAX_ANALYSIS_CHARS, omitted, 'truncated_run_code_output')
        : safe.content,
      description: safe.description,
      previewUrl: safe.previewUrl,
      code_path: safe.code_path,
      path: safe.path,
      storageUrl: safe.storageUrl,
      success: safe.success,
      message: safe.message,
    },
  };
}

function compactSmallStatusOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  const safe = sanitizeUnknown(output, omitted, TOOL_HISTORY_MAX_ANALYSIS_CHARS) as JsonRecord;
  return {
    type: 'json',
    value: {
      success: safe.success,
      message: safe.message,
      contentBlocked: safe.contentBlocked,
      taskId: safe.taskId,
      model: safe.model ?? safe.usedModel,
      duration: safe.duration,
    },
  };
}

function compactAnalysisOutput(output: unknown, omitted: string[]): ToolResultOutput {
  const safe = sanitizeUnknown(output, omitted, TOOL_HISTORY_MAX_ANALYSIS_CHARS);
  if (typeof safe === 'string') {
    return { type: 'text', value: truncateText(safe, TOOL_HISTORY_MAX_ANALYSIS_CHARS, omitted, 'truncated_analysis') };
  }
  return { type: 'json', value: safe };
}

function compactTranscriptOutput(output: JsonRecord, omitted: string[]): ToolResultOutput {
  if (output.error) return { type: 'error-text', value: String(output.error) };
  const transcript = output.transcript && typeof output.transcript === 'object'
    ? output.transcript as JsonRecord
    : undefined;
  if (!transcript) return { type: 'json', value: sanitizeUnknown(output, omitted, TOOL_HISTORY_MAX_ANALYSIS_CHARS) };

  const utterances = Array.isArray(transcript.utterances) ? transcript.utterances : [];
  if (utterances.length > 80) omitted.push('truncated_transcript_utterances');

  return {
    type: 'json',
    value: {
      cached: output.cached,
      media_index: output.media_index,
      videoUrl: output.videoUrl,
      provider: transcript.provider,
      model: transcript.model,
      durationMs: transcript.durationMs,
      text: typeof transcript.text === 'string'
        ? truncateText(transcript.text, TOOL_HISTORY_MAX_ANALYSIS_CHARS, omitted, 'truncated_transcript_text')
        : '',
      utteranceCount: utterances.length,
      utterances: utterances.slice(0, 80).map(item => {
        const u = item && typeof item === 'object' ? item as JsonRecord : {};
        const words = Array.isArray(u.words) ? u.words : [];
        return {
          startMs: u.startMs,
          endMs: u.endMs,
          speaker: u.speaker,
          text: u.text,
          words: words.slice(0, 40).map(word => {
            const w = word && typeof word === 'object' ? word as JsonRecord : {};
            return { text: w.text, startMs: w.startMs, endMs: w.endMs };
          }),
        };
      }),
    },
  };
}

function sanitizeOutput(toolName: string, rawOutput: unknown, omitted: string[]): ToolResultOutput {
  const output = rawOutput && typeof rawOutput === 'object' ? rawOutput as JsonRecord : { content: rawOutput };
  switch (toolName) {
    case 'read_file':
      return compactReadFileOutput(output, omitted);
    case 'list_files':
      return compactListFilesOutput(output, omitted);
    case 'preview_frame':
      return compactPreviewFrameOutput(output, omitted);
    case 'run_code':
    case 'write_file':
      return compactRunCodeOutput(output, omitted);
    case 'generate_image':
    case 'generate_animation':
    case 'rotate_camera':
    case 'generate_music':
      return compactSmallStatusOutput(output, omitted);
    case 'analyze_image':
    case 'analyze_video':
      return compactAnalysisOutput(rawOutput, omitted);
    case 'transcribe_audio':
      return compactTranscriptOutput(output, omitted);
    default:
      return { type: 'json', value: sanitizeUnknown(rawOutput, omitted, TOOL_HISTORY_MAX_OUTPUT_CHARS) };
  }
}

export function sanitizeToolHistory(
  toolName: string,
  rawInput: unknown,
  rawOutput: unknown,
  budget: ToolHistoryBudget,
): SanitizedToolHistory {
  const omitted: string[] = [];
  if (budget.rows >= TOOL_HISTORY_MAX_ROWS_PER_RUN || budget.chars >= TOOL_HISTORY_MAX_CHARS_PER_RUN) {
    omitted.push('run_budget_exceeded');
    const input = sanitizeUnknown(rawInput, omitted);
    const output: ToolResultOutput = {
      type: 'json',
      value: { omitted: true, reason: 'tool history run budget exceeded', toolName },
    };
    return {
      input,
      output,
      omitted,
      inputChars: jsonChars(input),
      outputChars: jsonChars(output),
    };
  }

  let input = sanitizeUnknown(rawInput, omitted);
  if (jsonChars(input) > TOOL_HISTORY_MAX_INPUT_CHARS) {
    omitted.push('truncated_input_json');
    input = {
      omitted: true,
      reason: 'input too large',
      preview: truncateText(JSON.stringify(input), TOOL_HISTORY_MAX_INPUT_CHARS, omitted, 'truncated_input_preview'),
    };
  }

  let output = sanitizeOutput(toolName, rawOutput, omitted);
  if (jsonChars(output) > TOOL_HISTORY_MAX_OUTPUT_CHARS) {
    omitted.push('truncated_output_json');
    output = {
      type: 'text',
      value: truncateText(JSON.stringify(output), TOOL_HISTORY_MAX_OUTPUT_CHARS, omitted, 'truncated_output_preview'),
    };
  }

  return {
    input,
    output,
    omitted: [...new Set(omitted)],
    inputChars: jsonChars(input),
    outputChars: jsonChars(output),
  };
}

function normalizeToolResultOutput(output: unknown): ToolResultOutput {
  if (output && typeof output === 'object' && 'type' in output && 'value' in output) {
    return output as ToolResultOutput;
  }
  return { type: 'json', value: output ?? {} };
}

function isReplayableToolRow(row: DbToolHistoryRow): boolean {
  if (row.tool_name !== 'run_code') return true;
  const input = row.input && typeof row.input === 'object' ? row.input as JsonRecord : {};
  const code = input.code;
  if (typeof code !== 'string' || !code.trim()) return false;
  return !TRUNCATED_RUN_CODE_MARKERS.some(marker => marker.test(code));
}

export function buildToolHistoryMessages(rows: DbToolHistoryRow[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const validRows = rows
    .filter(row => row.tool_call_id && row.tool_name)
    .filter(isReplayableToolRow)
    .sort((a, b) => a.seq - b.seq);
  if (!validRows.length) return messages;

  messages.push({
    role: 'assistant',
    content: validRows.map(row => ({
      type: 'tool-call',
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      input: row.input ?? {},
    })),
  } as ModelMessage);
  messages.push({
    role: 'tool',
    content: validRows.map(row => ({
      type: 'tool-result',
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      output: normalizeToolResultOutput(row.output),
    })),
  } as ModelMessage);

  return messages;
}

function groupToolRows(rows: DbToolHistoryRow[]) {
  const groups = new Map<string, { created_at: string; rows: DbToolHistoryRow[] }>();
  for (const row of rows) {
    if (!row.tool_call_id || !row.tool_name) continue;
    const key = `${row.run_id ?? 'no-run'}:${row.step}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (new Date(row.created_at).getTime() < new Date(group.created_at).getTime()) {
        group.created_at = row.created_at;
      }
    } else {
      groups.set(key, { created_at: row.created_at, rows: [row] });
    }
  }

  return [...groups.values()].map(group => ({
    created_at: group.created_at,
    rows: group.rows.sort((a, b) => a.seq - b.seq),
  }));
}

export function buildModelHistoryFromRows(
  visibleMessages: DbVisibleMessage[],
  toolRows: DbToolHistoryRow[],
  maxVisibleTurns = 50,
): ModelMessage[] {
  const visible = visibleMessages
    .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ ...m }));
  while (visible.length && visible[visible.length - 1].role === 'user') visible.pop();
  const selectedVisible = visible.slice(-maxVisibleTurns);
  const startAt = selectedVisible[0]?.created_at;
  const selectedTools = startAt ? toolRows.filter(row => row.created_at >= startAt) : [];

  const items = [
    ...selectedVisible.map(m => ({ kind: 'message' as const, created_at: m.created_at, value: m })),
    ...groupToolRows(selectedTools).map(group => ({ kind: 'tool' as const, created_at: group.created_at, value: group.rows })),
  ].sort((a, b) => {
    const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (t !== 0) return t;
    return a.kind === b.kind ? 0 : a.kind === 'message' ? -1 : 1;
  });

  const history: ModelMessage[] = [];
  for (const item of items) {
    if (item.kind === 'message') {
      history.push({ role: item.value.role, content: item.value.content } as ModelMessage);
    } else {
      history.push(...buildToolHistoryMessages(item.value));
    }
  }
  return history;
}
