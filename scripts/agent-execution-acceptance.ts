import assert from 'node:assert/strict';
import type { ModelMessage } from 'ai';
import {
  buildTypedCompactionMessage,
  getAgentContextPolicy,
  selectModelHistoryWithinBudget,
  shouldScheduleNextAttempt,
  type DurableExecutionSnapshot,
} from '../src/lib/agent-execution';
import {
  buildModelHistoryFromRows,
  sanitizeToolHistory,
} from '../src/lib/agentToolHistory';

function makeIso(index: number): string {
  return new Date(Date.UTC(2026, 6, 18, 0, 0, index)).toISOString();
}

const visible = Array.from({ length: 200 }, (_, round) => [
  {
    id: `user-${round}`,
    role: 'user' as const,
    content: `request-${round}`,
    created_at: makeIso(round * 3),
  },
  {
    id: `assistant-${round}`,
    role: 'assistant' as const,
    content: `result-${round}`,
    created_at: makeIso(round * 3 + 2),
  },
]).flat();
const tools = Array.from({ length: 200 }, (_, round) => ({
  created_at: makeIso(round * 3 + 1),
  run_id: `run-${round}`,
  step: round,
  seq: 0,
  tool_call_id: `tool-${round}`,
  tool_name: 'read_file',
  input: { path: `code/round-${round}.js` },
  output: { type: 'text' as const, value: `evidence-${round}` },
}));

const historyStartedAt = performance.now();
const history = buildModelHistoryFromRows(visible, tools);
const historyMs = performance.now() - historyStartedAt;
assert.equal(history.length, 800);
assert.match(JSON.stringify(history[0]), /request-0/);
assert.match(JSON.stringify(history.at(-1)), /result-199/);
assert.match(JSON.stringify(history), /evidence-199/);

const pressureMessages = Array.from({ length: 200 }, (_, index) => ({
  role: index % 2 ? 'assistant' : 'user',
  content: `${index}:${'context'.repeat(2_000)}`,
})) as ModelMessage[];
const selection = selectModelHistoryWithinBudget({
  messages: pressureMessages,
  policy: getAgentContextPolicy('gpt-5.6-sol'),
  reservedTokens: 100_000,
});
assert.equal(selection.messages.length, pressureMessages.length);
assert.equal(selection.stats.droppedMessages, 0);
assert.equal(selection.stats.compactionRequired, true);

const binary = 'a'.repeat(16_384);
const sanitized = sanitizeToolHistory(
  'custom_tool',
  { screenshot: binary, assetId: 'asset-1' },
  { base64Data: binary, snapshotId: 'snapshot-1' },
  { rows: 999, chars: 99_000_000 },
);
const sanitizedJson = JSON.stringify(sanitized);
assert.doesNotMatch(sanitizedJson, /a{100}/);
assert.match(sanitizedJson, /asset-1/);
assert.match(sanitizedJson, /snapshot-1/);

const snapshot: DurableExecutionSnapshot = {
  version: 1,
  objective: 'Continue a long Agent Run',
  acceptanceCriteria: [],
  decisions: [],
  completedWork: [],
  artifacts: [],
  openQuestions: [],
  currentWorkUnit: 'agent',
  nextAction: 'Continue',
  providerCompaction: {
    provider: 'openai',
    modelId: 'gpt-5.6-sol',
    compactedThrough: '2026-07-18T00:00:00.000Z',
    item: {
      kind: 'openai.compaction',
      providerKey: 'azure',
      itemId: 'cmp-acceptance',
      encryptedContent: 'encrypted-acceptance-state',
    },
  },
};
const compacted = buildTypedCompactionMessage(snapshot, 'gpt-5.6-sol');
assert.ok(compacted);
assert.match(JSON.stringify(compacted), /openai\.compaction/);
assert.match(JSON.stringify(compacted), /encrypted-acceptance-state/);
assert.equal(buildTypedCompactionMessage(snapshot, 'gpt-5.6-terra'), null);

assert.equal(shouldScheduleNextAttempt({
  executionStatus: 'running',
  attemptNo: 39,
  terminal: 'retryable',
}), true);
assert.equal(shouldScheduleNextAttempt({
  executionStatus: 'running',
  attemptNo: 40,
  terminal: 'retryable',
}), false);

console.log(JSON.stringify({
  status: 'passed',
  visibleRounds: 200,
  reconstructedModelMessages: history.length,
  reconstructionMs: Number(historyMs.toFixed(2)),
  droppedMessagesUnderPressure: selection.stats.droppedMessages,
  compactionRequired: selection.stats.compactionRequired,
  binaryPayloadRemoved: !sanitizedJson.includes(binary),
  providerCompactionReplayable: true,
  durableAttemptHandoffUntil: 40,
}, null, 2));
