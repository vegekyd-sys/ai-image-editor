import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentModelPreferenceStorageKey,
  loadAgentModelPreference,
  saveAgentModelPreference,
} from '@/lib/agent-model-preference';

describe('agent model preference persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('stores only the versioned per-project agent preference', () => {
    saveAgentModelPreference('project-a', 'grok-4.5');
    expect(loadAgentModelPreference('project-a')).toBe('grok-4.5');
    expect(loadAgentModelPreference('project-b')).toBe('auto');
    expect(JSON.parse(window.localStorage.getItem(
      getAgentModelPreferenceStorageKey('project-a'),
    ) || '{}')).toEqual({ v: 1, agentModel: 'grok-4.5' });
  });

  it('rejects stale, malformed, and non-allowlisted values', () => {
    const key = getAgentModelPreferenceStorageKey('project-a');
    window.localStorage.setItem(key, JSON.stringify({ v: 1, agentModel: 'evil/model' }));
    expect(loadAgentModelPreference('project-a')).toBe('auto');
    window.localStorage.setItem(key, JSON.stringify({ v: 0, agentModel: 'opus-4.8' }));
    expect(loadAgentModelPreference('project-a')).toBe('auto');
    window.localStorage.setItem(key, '{broken');
    expect(loadAgentModelPreference('project-a')).toBe('auto');
  });
});
