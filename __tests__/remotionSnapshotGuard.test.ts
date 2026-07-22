import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Remotion Snapshot promotion guard', () => {
  it('keeps candidate snapshots deployment-scoped instead of replacing shared Preview or Production env', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'scripts/create-remotion-snapshot.mjs'),
      'utf8',
    );

    expect(source).toContain("npx vercel -e REMOTION_SNAPSHOT_ID='");
    expect(source).not.toContain('vercel env add REMOTION_SNAPSHOT_ID preview');
    expect(source).not.toContain('vercel env add REMOTION_SNAPSHOT_ID production');
  });
});
