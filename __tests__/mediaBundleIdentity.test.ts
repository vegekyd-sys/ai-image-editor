// @vitest-environment node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('production media bundle identity', () => {
  it('resolves lazy media imports to one bundled runtime with compatible classes', async () => {
    const alias = nextConfig.turbopack?.resolveAlias?.mediabunny;
    expect(alias).toBe('./node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    if (typeof alias !== 'string') throw new Error('Missing media runtime alias');
    const runtime = await import(/* @vite-ignore */ pathToFileURL(path.resolve(alias)).href) as typeof import('mediabunny');
    const format = new runtime.Mp4OutputFormat({ fastStart: 'in-memory' });
    const target = new runtime.BufferTarget();
    expect(format).toBeInstanceOf(runtime.OutputFormat);
    expect(target).toBeInstanceOf(runtime.Target);
    const output = new runtime.Output({ format, target });
    expect(() => output.addVideoTrack(new runtime.EncodedVideoPacketSource('avc'))).not.toThrow();
    expect(output.state).toBe('pending');
  });
});
