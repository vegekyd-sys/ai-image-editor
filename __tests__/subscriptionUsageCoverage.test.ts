import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('personal subscription Usage coverage', () => {
  it('records actual-provider Agent usage in every execution entry point', () => {
    const streamingRoute = source('src/app/api/agent/route.ts');
    const backgroundRoute = source('src/app/api/agent/run/route.ts');
    const durableRunner = source('src/lib/agent-execution-runner.ts');
    const agent = source('src/lib/agent.ts');

    expect(agent).toContain('provider: runtime.spec.provider');
    expect(streamingRoute).toContain('recordAgentTokenUsage({');
    expect(streamingRoute).toContain('provider: usageEvent.provider || resolvedAgentModel.provider');
    expect(backgroundRoute).toContain('recordAgentTokenUsage({');
    expect(backgroundRoute).toContain('provider: agentProvider');
    expect(durableRunner).toContain('recordAgentTokenUsage({');
    expect(durableRunner).toContain('provider: billingProvider');
  });

  it('records Codex image and Grok video subscription tools at zero cost', () => {
    const agentTools = source('src/lib/agent-tools.ts');
    const animateRoute = source('src/app/api/animate/route.ts');
    const videoSnapshotRoute = source('src/app/api/video-snapshot/route.ts');
    const mcpRoute = source('src/app/api/mcp/route.ts');

    expect(agentTools).toContain("'codex-subscription',\n              'generate_image'");
    expect(agentTools).toContain("skillResult.provider === 'grok-subscription'");
    expect(animateRoute).toContain("recordSubscriptionUsage(\n            user.id,\n            'grok-subscription'");
    expect(videoSnapshotRoute).toContain("recordSubscriptionUsage(\n            userId,\n            'grok-subscription'");
    expect(mcpRoute).toContain("usage?.provider === 'codex-subscription'");
    expect(mcpRoute).toContain("meta?.provider === 'grok-subscription'");
  });
});
