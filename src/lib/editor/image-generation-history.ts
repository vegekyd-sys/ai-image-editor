import type { Snapshot, PhotoMetadata } from '@/types';

interface GenerationEvent { type: string; data: unknown; run_id?: string; seq?: number }

/** Recover historical per-image prompts from the tool/image log without database writes. */
export function restoreImageGenerationHistory(snapshots: Snapshot[], events: GenerationEvent[]): Snapshot[] {
  const byRun = new Map<string, GenerationEvent[]>();
  for (const event of events) {
    const run = event.run_id || '';
    const rows = byRun.get(run) || [];
    rows.push(event);
    byRun.set(run, rows);
  }
  const prompts = new Map<string, PhotoMetadata['imageGeneration']>();
  for (const [run, rows] of byRun) {
    let generation: PhotoMetadata['imageGeneration'];
    for (const row of rows.sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
      const data = row.data as Record<string, unknown> | null;
      if (!data) continue;
      if (row.type === 'tool_call') {
        generation = undefined;
        const input = data.input as Record<string, unknown> | undefined;
        if (data.tool === 'generate_image' && typeof input?.editPrompt === 'string') {
          generation = { id: `${run}:${row.seq}`, prompt: input.editPrompt, model: typeof input.model === 'string' ? input.model : '', promptKind: input.model === 'mj-v8.2' ? 'brief' : 'submitted' };
        }
      } else if (row.type === 'image' && typeof data.snapshotId === 'string' && generation) {
        const model = typeof data.usedModel === 'string' ? data.usedModel : generation.model;
        prompts.set(data.snapshotId, { ...generation, model, promptKind: model === 'mj-v8.2' ? 'brief' : 'submitted' });
      }
    }
  }
  return snapshots.map(snapshot => {
    const generation = prompts.get(snapshot.id);
    if (!generation || snapshot.metadata?.imageGeneration || snapshot.metadata?.midjourneyGeneration || snapshot.designPath || snapshot.design || snapshot.videoMeta) return snapshot;
    return { ...snapshot, metadata: { ...snapshot.metadata, imageGeneration: generation } };
  });
}
