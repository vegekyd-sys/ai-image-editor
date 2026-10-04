import {
  normalizeAgentModelPreference,
  type AgentModelPreference,
} from './agent-models';

const STORAGE_VERSION = 2;
const STORAGE_PREFIX = 'makaron:model-preferences:v2:';
const LEGACY_STORAGE_PREFIX = 'makaron:model-preferences:v1:';
const CREATE_STORAGE_KEY = 'makaron:create-agent-model:v2';
const LEGACY_CREATE_STORAGE_KEY = 'makaron:create-agent-model:v1';

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
  v: 2;
  agentModel: AgentModelPreference;
}

export function getAgentModelPreferenceStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function loadAgentModelPreference(projectId: string): AgentModelPreference {
  if (typeof window === 'undefined' || !projectId) return 'auto';
  try {
    const raw = window.localStorage.getItem(getAgentModelPreferenceStorageKey(projectId));
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredModelPreferences>;
      return stored.v === STORAGE_VERSION ? normalizeVisibleAgentModelPreference(stored.agentModel) : 'auto';
    }
    const legacyRaw = window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${projectId}`);
    if (!legacyRaw) return 'auto';
    const legacy = JSON.parse(legacyRaw) as { v?: number; agentModel?: string };
    if (legacy.v !== 1) return 'auto';
    // v1 wrote the implicit Luna default as an explicit Azure choice.
    return legacy.agentModel === 'gpt-6-luna' ? 'auto' : normalizeVisibleAgentModelPreference(legacy.agentModel);
  } catch {
    return 'auto';
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
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = window.localStorage.getItem(CREATE_STORAGE_KEY);
    if (saved !== null) return normalizeVisibleAgentModelPreference(saved);
    const legacy = window.localStorage.getItem(LEGACY_CREATE_STORAGE_KEY);
    return legacy === null || legacy === 'gpt-6-luna' ? 'auto' : normalizeVisibleAgentModelPreference(legacy);
  } catch {
    return 'auto';
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
