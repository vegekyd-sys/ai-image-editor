import { describe, expect, it, vi } from 'vitest';
import { stopAgentRun } from '@/lib/agent-run-stop';
import { wrapDurableInputAwareTools } from '@/lib/agent-tool-guards';

function database(results: unknown[]) {
  const calls: Array<{ table: string; update?: unknown; filters: unknown[] }> = [];
  const db = { from(table: string) {
    const call = { table, filters: [] } as typeof calls[number];
    calls.push(call);
    const result = results.shift();
    const query: any = {
      update(value: unknown) { call.update = value; return query; },
      select() { return query; },
      eq(key: string, value: unknown) { call.filters.push([key,value]); return query; },
      maybeSingle: async () => result,
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    return query;
  } };
  return { db: db as any, calls };
}

describe('stop and execution ownership', () => {
  it('clears recovery and closes only the owner’s running attempts', async () => {
    const {db,calls} = database([{data:{id:'r'},error:null},{error:null}]);
    expect(await stopAgentRun(db,'r','u')).toBe(true);
    expect(calls[0].update).toMatchObject({status:'aborted',lease_token:null,lease_owner:null,lease_expires_at:null,next_attempt_at:null});
    expect(calls[0].filters).toEqual([['id','r'],['user_id','u'],['status','running']]);
    expect(calls[1].filters).toEqual([['run_id','r'],['user_id','u'],['status','running']]);
    expect(calls[1].update).toMatchObject({status:'aborted',terminal_code:'user_aborted'});
  });
  it('allows cleanup to be retried after the run was already stopped', async () => {
    const {db,calls} = database([{data:null,error:null},{data:{id:'r'},error:null},{error:null}]);
    expect(await stopAgentRun(db,'r','u')).toBe(true);
    expect(calls[1].filters).toContainEqual(['status','aborted']);
    expect(calls[2].table).toBe('agent_attempts');
  });
  it('does not close attempts for a completed, absent, or foreign run', async () => {
    const {db,calls} = database([{data:null,error:null},{data:null,error:null}]);
    expect(await stopAgentRun(db,'r','u')).toBe(false);
    expect(calls.every(call => call.table === 'agent_runs')).toBe(true);
  });
  it.each([
    [{status:'aborted',input_version:0,lease_token:null},'agent_run_stopped'],
    [{status:'running',input_version:0,lease_token:'new'},'execution_lease_lost'],
    [{status:'running',input_version:1,lease_token:'old'},'agent_input_received'],
  ])('fences durable writes for state %j', async (state,code) => {
    const {db} = database([{data:state,error:null}]);
    const execute = vi.fn();
    const tools = wrapDurableInputAwareTools({write_file:{execute}}, {supabase:db,userId:'u',execution:{runId:'r',leaseToken:'old',inputEpoch:0}} as any);
    expect(await tools.write_file.execute({path:'saved.txt'})).toMatchObject({success:false,terminal:true,errorCode:code});
    expect(execute).not.toHaveBeenCalled();
  });
  it('permits a write with the current lease and input epoch', async () => {
    const {db} = database([{data:{status:'running',input_version:0,lease_token:'old'},error:null}]);
    const execute = vi.fn(async () => ({success:true}));
    const tools = wrapDurableInputAwareTools({write_file:{execute}}, {supabase:db,userId:'u',execution:{runId:'r',leaseToken:'old',inputEpoch:0}} as any);
    expect(await tools.write_file.execute({path:'saved.txt'})).toEqual({success:true});
    expect(execute).toHaveBeenCalledOnce();
  });
});
