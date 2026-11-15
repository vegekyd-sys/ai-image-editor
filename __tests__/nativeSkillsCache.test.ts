import { beforeEach, expect, it } from 'vitest';
import { readNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache';

const key = 'makaron:native-cache:/api/skills';
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

it('keeps the last complete skills catalog when a refresh returns an error body', () => {
  const catalog = { skills: [{ name: 'installed-skill' }] };
  writeNativeJSONCache('/api/skills', catalog);
  const stored = sessionStorage.getItem(key);
  writeNativeJSONCache('/api/skills', { error: 'Failed to load skills' });
  expect(readNativeJSONCache('/api/skills')).toEqual(catalog);
  expect(sessionStorage.getItem(key)).toBe(stored);
  expect(localStorage.getItem(key)).toBe(stored);
});

it('removes invalid skills cache entries written by older clients', () => {
  const error = JSON.stringify({ cachedAt: Date.now(), data: { error: 'Failed to load skills' } });
  sessionStorage.setItem(key, error);
  localStorage.setItem(key, error);
  expect(readNativeJSONCache('/api/skills')).toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
});

it('accepts a successfully loaded empty catalog', () => {
  writeNativeJSONCache('/api/skills', { skills: [] });
  expect(readNativeJSONCache('/api/skills')).toEqual({ skills: [] });
});

it('preserves other resources cache contracts', () => {
  writeNativeJSONCache('/api/billing/credits', { balance: 20 });
  expect(readNativeJSONCache('/api/billing/credits')).toEqual({ balance: 20 });
});
