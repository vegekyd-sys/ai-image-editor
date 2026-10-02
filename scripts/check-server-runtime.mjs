#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const checksumRoutes = [
  'agent',
  'agent/run',
  'agent/execution/[id]',
  'remotion/export',
  'remotion/export/[id]',
  'media/materialize',
  'video-snapshot/[snapshotId]',
  'cron/remotion-export',
  'cron/agent-executions',
  'cron/video-poll',
];

// Vercel packages these traced files. A package.json alone lets resolution
// succeed during the build, then crashes the function on its first request.
export function checkServerRuntime(root = process.cwd(), routes = checksumRoutes) {
  const failures = [];
  for (const route of routes) {
    const manifest = path.join(root, '.next/server/app/api', route, 'route.js.nft.json');
    if (!existsSync(manifest)) {
      failures.push(`/api/${route}: missing build trace`);
      continue;
    }
    const { files } = JSON.parse(readFileSync(manifest, 'utf8'));
    const entry = files?.find(file => file.replaceAll('\\', '/').endsWith('/@aws-crypto/crc32c/build/main/index.js'));
    if (!entry || !existsSync(path.resolve(path.dirname(manifest), entry))) {
      failures.push(`/api/${route}: missing @aws-crypto/crc32c runtime entry`);
    }
  }
  if (failures.length) throw new Error(`Server runtime packaging check failed:\n${failures.join('\n')}`);
  return routes.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Server runtime packaging: ${checkServerRuntime()} API traces include the CRC32C entry.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
