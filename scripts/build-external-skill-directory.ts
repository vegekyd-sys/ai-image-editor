import { syncDirectory } from './lib/external-skill-directory';
const catalog = syncDirectory(process.cwd(), process.argv.includes('--check'));
console.log(`External Skill directory: ${catalog.entries.length} entries, revision ${catalog.revision.slice(0,12)}.`);
