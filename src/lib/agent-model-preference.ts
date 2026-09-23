import {
  normalizeAgentModelPreference,
  type AgentModelPreference,
} from './agent-models';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'makaron:model-preferences:v1:';
const CREATE_STORAGE_KEY = 'makaron:create-agent-model:v1';

const HIDDEN_MODEL_REPLACEMENTS: Record<string, AgentModelPreference> = {
  'gpt-5.6-terra': 'gpt-6-luna',
  'gpt-5.6-sol': 'gpt-6-sol',
  'gpt-5.6-luna': 'gpt-6-luna',
  'gpt-5.6-terra-codex-subscription': 'gpt-6-luna-codex-subscription',
  'gpt-5.6-sol-codex-subscription': 'gpt-6-sol-codex-subscription',
  'gpt-5.6-luna-codex-subscription': 'gpt-6-luna-codex-subscription',
};

function normalizeVisibleAgentModelPreference(value: unknown): AgentModelPreference {
  return typeof value === 'string' && HIDDEN_MODEL_REPLACEMENTS[value]
    ? HIDDEN_MODEL_REPLACEMENTS[value]
    : normalizeAgentModelPreference(value);
}

interface StoredModelPreferences {
  v: 1;
  agentModel: AgentModelPreference;
}

export function getAgentModelPreferenceStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function loadAgentModelPreference(projectId: string): AgentModelPreference {
  if (typeof window === 'undefined' || !projectId) return 'gpt-6-luna';
  try {
    const raw = window.localStorage.getItem(getAgentModelPreferenceStorageKey(projectId));
    if (!raw) return 'gpt-6-luna';
    const stored = JSON.parse(raw) as Partial<StoredModelPreferences>;
    if (stored.v !== STORAGE_VERSION) return 'gpt-6-luna';
    return normalizeVisibleAgentModelPreference(stored.agentModel);
  } catch {
    return 'gpt-6-luna';
  }
}

export function saveAgentModelPreference(
  projectId: string,
  agentModel: AgentModelPreference,
): void {
  if (typeof window === 'undefined' || !projectId) return;
  try {
    const value: StoredModelPreferences = {
      v: STORAGE_VERSION,
      agentModel: normalizeAgentModelPreference(agentModel),
    };
    window.localStorage.setItem(
      getAgentModelPreferenceStorageKey(projectId),
      JSON.stringify(value),
    );
  } catch {
    // Safari private browsing and storage quotas can make localStorage throw.
  }
}

export function loadCreateAgentModelPreference(): AgentModelPreference {
  if (typeof window === 'undefined') return 'gpt-6-luna';
  try {
    const saved = window.localStorage.getItem(CREATE_STORAGE_KEY);
    return saved === null ? 'gpt-6-luna' : normalizeVisibleAgentModelPreference(saved);
  } catch {
    return 'gpt-6-luna';
  }
}

export function saveCreateAgentModelPreference(agentModel: AgentModelPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CREATE_STORAGE_KEY, normalizeAgentModelPreference(agentModel));
  } catch {
    // Safari private browsing and storage quotas can make localStorage throw.
  }
}
