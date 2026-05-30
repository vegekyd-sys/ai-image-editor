import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'packages/makaron-cli/SKILL.md',
  'packages/makaron-cli/skills/makaron/SKILL.md',
  'packages/makaron-cli/README.md',
].map(relative => path.join(root, relative));

const failures = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf-8');

  if (!/responses\s+get\s+\$RUN_ID\s+--pick\s+project_url/.test(content)) {
    failures.push(`${relative}: missing canonical service-flow project link command: responses get $RUN_ID --pick project_url`);
  }

  if (!/responses\s+get\s+\$RUN_ID\s+--wait\s+--json/.test(content)) {
    failures.push(`${relative}: missing canonical service-flow wait command: responses get $RUN_ID --wait --json`);
  }

  if (!/Advanced: stream incremental events/.test(content) || !/responses\s+watch\s+<runId>\s+--jsonl/.test(content)) {
    failures.push(`${relative}: watch must be documented only as an advanced incremental streaming path`);
  }

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (/responses\s+watch\s+\$RUN_ID/.test(line)) {
      failures.push(`${relative}:${index + 1} uses responses watch with service-flow RUN_ID; use responses get $RUN_ID --wait --json as the default customer-service path`);
    }
    if (/responses\s+watch\s+\$RUN_ID\s+--pick/.test(line)) {
      failures.push(`${relative}:${index + 1} uses watch for picking a field; use responses get $RUN_ID --pick <field>`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Makaron CLI agent docs lint passed (${files.length} files).`);
