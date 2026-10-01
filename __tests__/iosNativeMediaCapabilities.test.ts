// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../ios/App/App/MakaronBridgeViewController.swift', import.meta.url), 'utf8');
const script = source.match(/let script = "(Object\.defineProperty[^\n]+)"/)?.[1];

describe('native media protocol advertisement', () => {
  it('injects immutable capabilities before the main page loads', () => {
    expect(script).toBeTruthy();
    const capabilities = { protocolVersion: 1, watermarkedVideo: true, appVersion: '1.0.9', build: '18' };
    const window: Record<string, unknown> = {};
    runInNewContext(script!.replace('\\(json)', JSON.stringify(capabilities)), { window });
    expect(window.__MAKARON_NATIVE_MEDIA__).toEqual(capabilities);
    expect(Object.isFrozen(window.__MAKARON_NATIVE_MEDIA__)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window, '__MAKARON_NATIVE_MEDIA__')).toMatchObject({ writable: false, configurable: false });
    expect(source).toContain('"protocolVersion": 1');expect(source).toContain('"watermarkedVideo": true');
    expect(source).toContain('injectionTime: .atDocumentStart, forMainFrameOnly: true');
  });
});
