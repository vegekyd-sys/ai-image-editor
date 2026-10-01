import { describe, expect, it } from 'vitest';
import { artifactContinuationId, resolveArtifactContinuation } from '@/lib/artifact-continuation';

function db({ owner = true, status = 'completed', policy = 'auto' } = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { calls.push([table, field, value]); return query; },
        async maybeSingle() {
          return { data: table === 'projects' ? (owner ? { id: 'project' } : null) : {
            video_meta: { status, videoUrl: 'https://example.com/native.mp4', taskId: 'task', completionActions: [{ policy, prompt: 'Use selected Skill; publish the completed result.' }] },
          } };
        },
      };
      return query;
    },
  };
  return { client: client as never, calls };
}

describe('authorized artifact continuation', () => {
  it('uses the stored instruction and a stable run identity on reconnect', async () => {
    const { client, calls } = db();
    const input = { snapshotId: 'native', actionIndex: 0, prompt: 'caller replacement' };
    const first = await resolveArtifactContinuation(client, 'owner', 'project', input);
    const repeat = await resolveArtifactContinuation(client, 'owner', 'project', input);
    expect(first).toEqual(repeat);
    expect(first).toMatchObject({ snapshotId: 'native', actionIndex: 0 });
    expect('prompt' in first && first.prompt).toContain('Use selected Skill');
    expect('prompt' in first && first.prompt).not.toContain('caller replacement');
    expect(calls).toContainEqual(['projects', 'user_id', 'owner']);
    expect(calls).toContainEqual(['snapshots', 'project_id', 'project']);
  });
  it('blocks public/non-owned projects, pending artifacts, and confirm-only actions', async () => {
    for (const [fixture, status] of [[{ owner: false }, 404], [{ status: 'processing' }, 409], [{ policy: 'confirm' }, 400]] as const) {
      const result = await resolveArtifactContinuation(db(fixture).client, 'owner', 'project', { snapshotId: 'native', actionIndex: 0 });
      expect(result).toMatchObject({ status });
    }
  });
  it('separates independent actions and rejects invalid indices', async () => {
    expect(artifactContinuationId('one', 0, 'same')).not.toEqual(artifactContinuationId('two', 0, 'same'));
    expect(artifactContinuationId('one', 0, 'same')).not.toEqual(artifactContinuationId('one', 1, 'same'));
    expect(artifactContinuationId('one', 0, 'same')).not.toEqual(artifactContinuationId('one', 0, 'changed'));
    expect(await resolveArtifactContinuation(db().client, 'owner', 'project', { snapshotId: 'native', actionIndex: 4 })).toMatchObject({ status: 400 });
  });
});
