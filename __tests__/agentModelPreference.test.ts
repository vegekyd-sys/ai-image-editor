import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentModelPreferenceStorageKey,
  loadCreateAgentModelPreference,
  loadAgentModelPreference,
  saveCreateAgentModelPreference,
  saveAgentModelPreference,
} from '@/lib/agent-model-preference';

describe('agent model preference persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('stores only the versioned per-project agent preference', () => {
    saveAgentModelPreference('project-a', 'gpt-5.6-sol');
    expect(loadAgentModelPreference('project-a')).toBe('gpt-5.6-sol');
    expect(loadAgentModelPreference('project-b')).toBe('auto');
    expect(JSON.parse(window.localStorage.getItem(
      getAgentModelPreferenceStorageKey('project-a'),
    ) || '{}')).toEqual({ v: 1, agentModel: 'gpt-5.6-sol' });
  });

  it('rejects stale, malformed, and non-allowlisted values', () => {
    const key = getAgentModelPreferenceStorageKey('project-a');
    window.localStorage.setItem(key, JSON.stringify({ v: 1, agentModel: 'evil/model' }));
    expect(loadAgentModelPreference('project-a')).toBe('auto');
    window.localStorage.setItem(key, JSON.stringify({ v: 0, agentModel: 'gpt-5.6-luna' }));
    expect(loadAgentModelPreference('project-a')).toBe('auto');
    window.localStorage.setItem(key, '{broken');
    expect(loadAgentModelPreference('project-a')).toBe('auto');
  });

  it('retires stale Claude selections to auto while preserving GPT-5.6 create choices', () => {
    const key = getAgentModelPreferenceStorageKey('project-a');
    window.localStorage.setItem(key, JSON.stringify({ v: 1, agentModel: 'sonnet-5' }));
    expect(loadAgentModelPreference('project-a')).toBe('auto');

    window.localStorage.setItem('makaron:create-agent-model:v1', 'opus-4.8');
    expect(loadCreateAgentModelPreference()).toBe('auto');

    saveCreateAgentModelPreference('gpt-5.6-luna');
    expect(loadCreateAgentModelPreference()).toBe('gpt-5.6-luna');
  });

  it('upgrades persisted Grok 4.5 selections to Grok 4.6', () => {
    const key = getAgentModelPreferenceStorageKey('project-a');
    window.localStorage.setItem(key, JSON.stringify({ v: 1, agentModel: 'grok-4.5' }));
    expect(loadAgentModelPreference('project-a')).toBe('grok-4.6');

    window.localStorage.setItem('makaron:create-agent-model:v1', 'grok-4.5');
    expect(loadCreateAgentModelPreference()).toBe('grok-4.6');
  });
});
