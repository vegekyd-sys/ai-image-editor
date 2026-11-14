#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Measure the files Vercel receives from Next, counting distinct deployment
// paths (not inodes: pnpm hard links still occupy space inside the function).
export function measureDeploymentFootprint(root = process.cwd()) {
  const api = path.join(root, '.next/server/app/api');
  const routes = [];
  for (const relative of readdirSync(api, { recursive: true })) {
    if (typeof relative !== 'string' || !relative.endsWith('/route.js.nft.json')) continue;
    const manifest = path.join(api, relative);
    const files = new Set(JSON.parse(readFileSync(manifest, 'utf8')).files);
    const packages = new Map();
    const localBuildTools = new Set();
    let bytes = 0;
    for (const file of files) {
      const full = path.resolve(path.dirname(manifest), file);
      const size = statSync(full).size;
      bytes += size;
      const normalized = path.relative(root, full).replaceAll('\\', '/');
      const nodePath = normalized.split('node_modules/').at(-1);
      const parts = nodePath.split('/');
      const key = normalized.includes('node_modules/')
        ? parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')
        : `[app]/${normalized.split('/')[0]}`;
      packages.set(key, (packages.get(key) || 0) + size);
      if (['@remotion/bundler', 'webpack', '@rspack/core', 'typescript'].includes(key)) localBuildTools.add(key);
    }
    routes.push({ route: `/api/${relative.replace('/route.js.nft.json', '')}`, bytes,
      files: files.size, localBuildTools: [...localBuildTools],
      largest: [...packages].sort((a, b) => b[1] - a[1]).slice(0, 12) });
  }
  return { platform: process.platform, arch: process.arch,
    routes: routes.sort((a, b) => b.bytes - a.bytes) };
}

export function checkCloudDeploymentFootprint(root = process.cwd(), budgetBytes = 220_000_000) {
  const report = measureDeploymentFootprint(root);
  for (const route of report.routes) {
    if (route.localBuildTools.length) throw new Error(`${route.route}: local renderer build tools entered cloud trace: ${route.localBuildTools.join(', ')}`);
    if (route.bytes > budgetBytes) throw new Error(`${route.route}: ${route.bytes} bytes exceeds cloud trace budget ${budgetBytes}`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = measureDeploymentFootprint();
  console.log(`DEPLOYMENT_FOOTPRINT ${JSON.stringify({ ...report, routes: report.routes.slice(0, 5) })}`);
}
