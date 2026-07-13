import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const longRunningRoutes = [
  'src/app/api/agent/route.ts',
  'src/app/api/agent/run/route.ts',
  'src/app/api/agent/execution/[id]/route.ts',
  'src/app/api/cron/agent-executions/route.ts',
  'src/app/api/cron/video-poll/route.ts',
  'src/app/api/animate/route.ts',
  'src/app/api/video-snapshot/route.ts',
  'src/app/api/video-snapshot/[snapshotId]/route.ts',
  'src/app/api/remotion/export/route.ts',
];

describe('Vercel long-running functions', () => {
  it.each(longRunningRoutes)('%s opts into the Pro Fluid Compute maximum', route => {
    const source = fs.readFileSync(path.join(root, route), 'utf8');
    expect(source).toMatch(/export const maxDuration = 1800;?/);
  });
});
