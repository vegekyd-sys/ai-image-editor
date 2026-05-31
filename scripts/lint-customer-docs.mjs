import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const candidateRoots = [
  'docs/customer-facing',
  'docs/public',
  'packages/makaron-cli/customer-facing',
].map(relative => path.join(root, relative));

const banned = [
  { pattern: /\brunId\b/g, label: 'runId' },
  { pattern: /\btaskId\b/g, label: 'taskId' },
  { pattern: /\bartifacts?\b/gi, label: 'artifact' },
  { pattern: /\bpoll(?:ing)?\b/gi, label: 'poll' },
  { pattern: /\bresponses\s+watch\b/gi, label: 'responses watch' },
  { pattern: /\bwatch\s+--jsonl\b/gi, label: 'watch --jsonl' },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (/\.(md|mdx|txt)$/i.test(entry.name)) return [fullPath];
    return [];
  });
}

const files = candidateRoots.flatMap(walk);
const failures = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of banned) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        failures.push(`${path.relative(root, file)}:${index + 1} contains customer-facing internal term "${rule.label}"`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Customer-facing docs lint passed (${files.length} files).`);
