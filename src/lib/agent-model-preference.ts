import {
  normalizeAgentModelPreference,
  type AgentModelPreference,
} from './agent-models';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'makaron:model-preferences:v1:';

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
