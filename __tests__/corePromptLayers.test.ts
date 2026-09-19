// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('core prompt layers', () => {
  it('preserves all frozen rules and delivers deferred contracts through the real read_file tool', () => {
    const output=execFileSync(process.execPath,['--import','tsx','--require','./md-loader.cjs','benchmarks/core-prompt/check-contracts.ts'],{cwd:process.cwd(),encoding:'utf8',timeout:30_000});
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({passed:true,coreParagraphs:54,protectedCreativeFiles:12,actualReadFileBundles:2});
  }, 30_000);
});
