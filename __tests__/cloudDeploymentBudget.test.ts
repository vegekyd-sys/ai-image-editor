import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCloudDeploymentFootprint } from '../scripts/measure-deployment-footprint.mjs';

const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cloud-footprint-'));
  roots.push(root);
  const manifest = path.join(root, '.next/server/app/api/agent/route.js.nft.json');
  mkdirSync(path.dirname(manifest), { recursive: true });
  for (const [relative, data] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  writeFileSync(manifest, JSON.stringify({ files: Object.keys(files).map(file => path.relative(path.dirname(manifest), path.join(root, file))) }));
  return root;
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe('cloud function packaging budget', () => {
  it('keeps the required media binary and font metadata within the budget', () => {
    const root = fixture({ 'node_modules/ffmpeg-static/ffmpeg': 'binary', 'node_modules/@remotion/google-fonts/dist/cjs/index.js': 'fonts' });
    const report = checkCloudDeploymentFootprint(root, 11);
    expect(report.routes[0].bytes).toBe(11);
  });
  it('rejects a real local compiler file pulled into an API trace', () => {
    const root = fixture({ 'node_modules/typescript/lib/typescript.js': 'compiler' });
    expect(() => checkCloudDeploymentFootprint(root)).toThrow('local renderer build tools');
  });
  it('rejects a function over budget even when it contains no compiler', () => {
    const root = fixture({ 'node_modules/ffmpeg-static/ffmpeg': 'binary' });
    expect(() => checkCloudDeploymentFootprint(root, 5)).toThrow('exceeds cloud trace budget');
  });
  it('rejects an incomplete trace instead of silently undercounting', () => {
    const root = fixture({ 'node_modules/ffmpeg-static/ffmpeg': 'binary' });
    rmSync(path.join(root, 'node_modules/ffmpeg-static/ffmpeg'));
    expect(() => checkCloudDeploymentFootprint(root)).toThrow();
  });
});
