import {
  normalizeAgentModelPreference,
  type AgentModelPreference,
} from './agent-models';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'makaron:model-preferences:v1:';
const CREATE_STORAGE_KEY = 'makaron:create-agent-model:v1';

interface StoredModelPreferences {
  v: 1;
  agentModel: AgentModelPreference;
}

export function getAgentModelPreferenceStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function loadAgentModelPreference(projectId: string): AgentModelPreference {
  if (typeof window === 'undefined' || !projectId) return 'auto';
  try {
    const raw = window.localStorage.getItem(getAgentModelPreferenceStorageKey(projectId));
    if (!raw) return 'auto';
    const stored = JSON.parse(raw) as Partial<StoredModelPreferences>;
    if (stored.v !== STORAGE_VERSION) return 'auto';
    return normalizeAgentModelPreference(stored.agentModel);
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
    return normalizeAgentModelPreference(window.localStorage.getItem(CREATE_STORAGE_KEY));
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
