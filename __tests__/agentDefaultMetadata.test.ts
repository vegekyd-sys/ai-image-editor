import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveAgentModelSpecForUser } from '@/lib/agent-models';

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: vi.fn(async () => ({ auth: { userId: 'regular-user' } })) }));
vi.mock('@/lib/codex-subscription-allowlist', () => ({ isDynamicCodexSubscriptionUserAllowed: vi.fn(async () => false) }));
vi.mock('@/lib/codex-subscription', () => ({ getCodexSubscriptionUsage: vi.fn() }));
vi.mock('@/lib/grok-subscription', () => ({ isGrokSubscriptionAllowedUser: vi.fn(async () => false), getGrokSubscriptionUsage: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

describe('configured DeepSeek default', () => {
  it('defaults unconfigured Auto to native-vision Flash for regular and plan-enabled users', () => {
    vi.stubEnv('AGENT_MODEL', '');
    for (const allowed of [true, false]) {
      expect(resolveAgentModelSpecForUser('auto', undefined, 'user', 'azure-openai', allowed))
        .toMatchObject({ id: 'deepseek-flash', provider: 'deepseek', supportsImageInput: true });
    }
  });
  it('reports actual Auto identity even when subscription usage is unavailable', async () => {
    vi.stubEnv('AGENT_MODEL', 'deepseek-flash');
    const { GET } = await import('@/app/api/agent/subscription-usage/route');
    const response = await GET(new NextRequest('http://localhost/api/agent/subscription-usage'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ available: false, defaultModelId: 'deepseek-flash', defaultProvider: 'deepseek' });
  });

  it('uses DeepSeek for Auto without overriding explicit Luna routes or allowlists', () => {
    vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner');
    for (const allowed of [true, false]) {
      expect(resolveAgentModelSpecForUser('auto', 'deepseek-flash', 'user', 'azure-openai', allowed))
        .toMatchObject({ id: 'deepseek-flash', provider: 'deepseek' });
    }
    expect(resolveAgentModelSpecForUser('gpt-6-luna', 'deepseek-flash', 'user', 'azure-openai', true))
      .toMatchObject({ id: 'gpt-6-luna', provider: 'azure-openai' });
    expect(resolveAgentModelSpecForUser('gpt-6-luna-codex-subscription', 'deepseek-flash', 'user', 'azure-openai', true))
      .toMatchObject({ id: 'gpt-6-luna', provider: 'codex-subscription' });
  });
});
