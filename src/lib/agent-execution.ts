import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';

export const EXECUTION_SCHEMA_VERSION = 1;
export const DEFAULT_ATTEMPT_LEASE_SECONDS = 480;
export const DEFAULT_ATTEMPT_BUDGET_MS = 420_000;
export const DEFAULT_ATTEMPT_MAX_STEPS = 24;
export const DEFAULT_MAX_ATTEMPTS = 40;

export interface AgentContextPolicy {
  contextWindowTokens: number;
  historySoftLimitTokens: number;
  providerClearToolUsesAtTokens: number;
  providerCompactAtTokens: number;
}

export interface ExecutionArtifactPointer {
  kind: string;
  path?: string;
  url?: string;
  label?: string;
}

export interface DurableExecutionSnapshot {
  version: 1;
  objective: string;
  acceptanceCriteria: string[];
  decisions: string[];
  completedWork: string[];
  artifacts: ExecutionArtifactPointer[];
  openQuestions: string[];
  nextAction: string;
  currentWorkUnit: string;
  attemptSummary?: string;
  checkpoint?: Record<string, unknown>;
  providerCompaction?: {
    summary: string;
    appliedEdits: Array<Record<string, unknown>>;
    inputTokens?: number;
  };
}

export interface DurableExecutionRef {
  runId: string;
  attemptId: string;
  attemptNo: number;
  workUnitKey: string;
}

export interface ContextSelectionStats {
  estimatedTokens: number;
  availableTokens: number;
  selectedMessages: number;
  droppedMessages: number;
  usedSnapshot: boolean;
}

export interface ExecutionLeaseState {
  status?: string | null;
  lease_token?: string | null;
}

export function isConfirmedExecutionLeaseLoss(input: {
  renewSucceeded: boolean;
  renewError?: unknown;
  verifyError?: unknown;
  state?: ExecutionLeaseState | null;
  expectedLeaseToken: string;
}): boolean {
  if (input.renewSucceeded) return false;
  if (input.renewError || input.verifyError || !input.state) return false;
  return input.state.status !== 'running'
    || input.state.lease_token !== input.expectedLeaseToken;
}

export function isRetryableProviderOutage(detail: unknown): boolean {
  if (typeof detail !== 'string' || !detail.trim()) return false;
  return /(?:serviceunavailableexception|bedrock.{0,120}(?:unable to process|service unavailable)|\b503\b|econnreset|tls connection was established)/i.test(detail);
}

export function getAgentContextPolicy(modelId: string): AgentContextPolicy {
  if (modelId === 'sonnet-5' || modelId.includes('claude-sonnet-5')) {
    return {
      contextWindowTokens: 1_000_000,
      historySoftLimitTokens: 420_000,
      providerClearToolUsesAtTokens: 500_000,
      providerCompactAtTokens: 650_000,
    };
  }
  return {
    contextWindowTokens: 200_000,
    historySoftLimitTokens: 105_000,
    providerClearToolUsesAtTokens: 120_000,
    providerCompactAtTokens: 155_000,
  };
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const bytes = new TextEncoder().encode(text).length;
  return Math.max(1, Math.ceil(bytes / 3.2));
}

export function estimateModelMessageTokens(message: ModelMessage): number {
  return 8 + estimateTextTokens(JSON.stringify(message));
}

function isToolCallMessage(message: ModelMessage): boolean {
  return message.role === 'assistant'
    && Array.isArray(message.content)
    && message.content.some((part: unknown) => (
      !!part && typeof part === 'object' && (part as { type?: string }).type === 'tool-call'
    ));
}

function atomicMessageGroups(messages: ModelMessage[]): ModelMessage[][] {
  const groups: ModelMessage[][] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (isToolCallMessage(message) && messages[i + 1]?.role === 'tool') {
      groups.push([message, messages[++i]]);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

export function tailModelHistoryAtomically(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  const limit = Math.max(1, Math.floor(maxMessages));
  const groups = atomicMessageGroups(messages);
  const selected: ModelMessage[][] = [];
  let count = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (selected.length > 0 && count + group.length > limit) break;
    selected.unshift(group);
    count += group.length;
  }
  return selected.flat();
}

export function selectModelHistoryWithinBudget(input: {
  messages: ModelMessage[];
  policy: AgentContextPolicy;
  reservedTokens?: number;
  snapshot?: DurableExecutionSnapshot | null;
}): { messages: ModelMessage[]; stats: ContextSelectionStats } {
  const reservedTokens = Math.max(0, input.reservedTokens ?? 0);
  const availableTokens = Math.max(
    8_000,
    Math.min(
      input.policy.historySoftLimitTokens,
      input.policy.providerCompactAtTokens - reservedTokens - 16_000,
    ),
  );
  const groups = atomicMessageGroups(input.messages);
  const selected: ModelMessage[][] = [];
  let estimatedTokens = 0;

  for (let i = groups.length - 1; i >= 0; i--) {
    const groupTokens = groups[i].reduce((sum, message) => sum + estimateModelMessageTokens(message), 0);
    if (selected.length > 0 && estimatedTokens + groupTokens > availableTokens) break;
    if (groupTokens > availableTokens && selected.length === 0) continue;
    selected.unshift(groups[i]);
    estimatedTokens += groupTokens;
  }

  const selectedMessages = selected.flat();
  return {
    messages: selectedMessages,
    stats: {
      estimatedTokens,
      availableTokens,
      selectedMessages: selectedMessages.length,
      droppedMessages: Math.max(0, input.messages.length - selectedMessages.length),
      usedSnapshot: Boolean(input.snapshot),
    },
  };
}

export function formatDurableExecutionSnapshot(snapshot: DurableExecutionSnapshot | null | undefined): string {
  if (!snapshot) return '';
  const lines = [
    '[Durable Execution Handoff]',
    `Objective: ${snapshot.objective}`,
    snapshot.acceptanceCriteria.length ? `Acceptance criteria:\n${snapshot.acceptanceCriteria.map(item => `- ${item}`).join('\n')}` : '',
    snapshot.decisions.length ? `Decisions that must be preserved:\n${snapshot.decisions.map(item => `- ${item}`).join('\n')}` : '',
    snapshot.completedWork.length ? `Completed work:\n${snapshot.completedWork.map(item => `- ${item}`).join('\n')}` : '',
    snapshot.artifacts.length ? `Durable artifacts:\n${snapshot.artifacts.map(item => `- ${item.kind}: ${item.path || item.url || item.label || 'persisted'}`).join('\n')}` : '',
    snapshot.openQuestions.length ? `Open questions:\n${snapshot.openQuestions.map(item => `- ${item}`).join('\n')}` : '',
    `Current work unit: ${snapshot.currentWorkUnit}`,
    snapshot.attemptSummary ? `Previous attempt summary: ${snapshot.attemptSummary}` : '',
    `Next action: ${snapshot.nextAction}`,
    'Continue from this handoff. Do not repeat completed side effects or reread broad skill catalogs.',
    '',
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

export function normalizeExecutionSnapshot(
  value: unknown,
  fallback: Pick<DurableExecutionSnapshot, 'objective' | 'currentWorkUnit' | 'nextAction'>,
): DurableExecutionSnapshot {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const strings = (key: string) => Array.isArray(record[key])
    ? (record[key] as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 50)
    : [];
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.filter((item): item is ExecutionArtifactPointer => !!item && typeof item === 'object').slice(0, 50)
    : [];
  return {
    version: 1,
    objective: typeof record.objective === 'string' && record.objective.trim()
      ? record.objective
      : fallback.objective,
    acceptanceCriteria: strings('acceptanceCriteria'),
    decisions: strings('decisions'),
    completedWork: strings('completedWork'),
    artifacts,
    openQuestions: strings('openQuestions'),
    nextAction: typeof record.nextAction === 'string' && record.nextAction.trim()
      ? record.nextAction
      : fallback.nextAction,
    currentWorkUnit: typeof record.currentWorkUnit === 'string' && record.currentWorkUnit.trim()
      ? record.currentWorkUnit
      : fallback.currentWorkUnit,
    attemptSummary: typeof record.attemptSummary === 'string' ? record.attemptSummary.slice(0, 12_000) : undefined,
    checkpoint: record.checkpoint && typeof record.checkpoint === 'object'
      ? record.checkpoint as Record<string, unknown>
      : undefined,
    providerCompaction: record.providerCompaction && typeof record.providerCompaction === 'object'
      ? record.providerCompaction as DurableExecutionSnapshot['providerCompaction']
      : undefined,
  };
}

export function buildTypedCompactionMessage(
  snapshot: DurableExecutionSnapshot | null | undefined,
): ModelMessage | null {
  const summary = snapshot?.providerCompaction?.summary?.trim();
  if (!summary) return null;
  return {
    role: 'assistant',
    content: [{
      type: 'text',
      text: summary,
      providerOptions: { anthropic: { type: 'compaction' } },
    }],
  } as ModelMessage;
}

export function stableOperationKey(workUnitKey: string, toolName: string, input: unknown): string {
  const stable = (value: unknown): string => {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`)
      .join(',')}}`;
  };
  const text = `${workUnitKey}\n${toolName}\n${stable(input)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return `${toolName}:${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function shouldScheduleNextAttempt(input: {
  executionStatus: string;
  attemptNo: number;
  maxAttempts?: number;
  terminal: 'completed' | 'retryable' | 'killed' | 'failed';
}): boolean {
  return input.executionStatus === 'running'
    && input.terminal !== 'completed'
    && input.terminal !== 'failed'
    && input.attemptNo < (input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
}

export class AgentExecutionStore {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string,
    private projectId?: string,
  ) {}

  async latestSnapshot(runId: string): Promise<DurableExecutionSnapshot | null> {
    let query = this.supabase
      .from('agent_context_snapshots')
      .select('content, run_id')
      .order('created_at', { ascending: false })
      .limit(1);
    query = this.projectId ? query.eq('project_id', this.projectId) : query.eq('run_id', runId);
    const { data, error } = await query.maybeSingle();
    if (error || !data?.content) return null;
    return normalizeExecutionSnapshot(data.content, {
      objective: '',
      currentWorkUnit: 'agent',
      nextAction: 'Continue the unfinished objective.',
    });
  }

  async saveSnapshot(input: {
    runId: string;
    attemptId?: string;
    projectId?: string;
    kind?: string;
    sourceEventSeq?: number;
    snapshot: DurableExecutionSnapshot;
    providerCompaction?: Record<string, unknown>;
  }): Promise<string | null> {
    const tokenEstimate = estimateTextTokens(JSON.stringify(input.snapshot));
    const { data, error } = await this.supabase.from('agent_context_snapshots').insert({
      run_id: input.runId,
      attempt_id: input.attemptId,
      project_id: input.projectId || this.projectId,
      user_id: this.userId,
      version: EXECUTION_SCHEMA_VERSION,
      kind: input.kind || 'handoff',
      source_event_seq: input.sourceEventSeq,
      token_estimate: tokenEstimate,
      content: input.snapshot,
      provider_compaction: input.providerCompaction,
    }).select('id').single();
    if (error) throw new Error(`Failed to persist Agent context snapshot: ${error.message}`);
    return data?.id ?? null;
  }
}
