/** Read-only operator recovery for an accepted candidate task. Never submits or bills an image. */
import { config } from 'dotenv';
import { querySeedream55Task } from '../src/lib/models/seedream55';

async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf('--env');
  if (envIndex >= 0) config({ path: args[envIndex + 1], quiet: true });
  const taskId = args[0];
  if (!taskId || taskId.startsWith('-')) throw new Error('Usage: npx tsx scripts/seedream55-query.ts <taskId> [--env <private-env-file>]');
  const result = await querySeedream55Task(taskId);
  // No source URLs, credential values or provider error bodies in stdout.
  console.log(JSON.stringify({ taskId: result.taskId, provider: result.provider, model: result.model, status: result.status, outputCount: result.outputs.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Task query failed. No new submission.'); process.exitCode = 1; });
