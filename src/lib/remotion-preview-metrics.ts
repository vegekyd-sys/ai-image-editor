import type { Sandbox } from '@vercel/sandbox';

export interface PreviewRenderMetrics {
  sandboxId: string;
  reused: boolean;
  prefetchMs: number;
  frameMs: number[];
  sourceCount: number;
  processId?: string;
  cacheOrigin?: string;
  batchMs?: number;
  memory?: Record<string, number | string | null>;
}

// Kernel high-water marks, not allocated memory or one renderer process's RSS.
export async function readPreviewMemory(sandbox: Sandbox): Promise<PreviewRenderMetrics['memory']> {
  const script = `const fs=require('fs');const read=p=>{try{return fs.readFileSync(p,'utf8').trim()}catch{return null}};const num=v=>v&&v!=='max'?Number(v):null;const v2=read('/sys/fs/cgroup/memory.current');const v1='/sys/fs/cgroup/memory/memory.';console.log(JSON.stringify({kind:v2?'cgroup-v2':'cgroup-v1',currentBytes:num(v2||read(v1+'usage_in_bytes')),peakBytes:num(read('/sys/fs/cgroup/memory.peak')||read(v1+'max_usage_in_bytes')),limitBytes:num(read('/sys/fs/cgroup/memory.max')||read(v1+'limit_in_bytes'))}));`;
  const command = await sandbox.runCommand({cmd:'node',args:['-e',script],signal:AbortSignal.timeout(10_000)});
  if (command.exitCode !== 0) return undefined;
  return JSON.parse(await command.stdout());
}
