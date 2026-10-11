import {describe,expect,it} from 'vitest';
import {deriveAgentRunProgress} from '@/lib/agent-run-progress';
import {countConsecutiveInterruptedAttempts} from '@/lib/agent-execution';
describe('Agent progress reporting',()=>{
 it('freezes run wall time at completion even when Studio is awaiting approval',()=>{
  const p=deriveAgentRunProgress({status:'completed',started_at:'2026-10-09T12:00:00Z',ended_at:'2026-10-09T12:01:00Z',now:Date.parse('2026-10-10T12:00:00Z'),outputs:[{type:'studio_run',status:'awaiting_approval'}]});
  expect(p.execution_phase).toBe('awaiting_approval');expect(p.run_wall_seconds).toBe(60);expect(p.delivery_status).toBe('none');
 });
 it('separates a stopped agent from an in-flight export',()=>{
  expect(deriveAgentRunProgress({status:'aborted',outputs:[{type:'video',status:'queued'}]})).toMatchObject({execution_phase:'stopped',delivery_status:'rendering'});
 });
 it('never reports a failed provider job as successful delivery',()=>{
  expect(deriveAgentRunProgress({status:'completed',outputs:[{type:'video',status:'failed'}]}).delivery_status).toBe('failed');
 });
 it('reports loss of heartbeat as recovery waiting instead of working',()=>{
  expect(deriveAgentRunProgress({status:'running',lastActivityAt:'2026-10-09T12:00:00Z',now:Date.parse('2026-10-09T12:03:00Z')})).toMatchObject({execution_phase:'recovery_wait',recovery_wait_seconds:180});
 });
 it('resets interruption escalation after new input or a normal handoff',()=>{
  const killed={terminal_code:'lease_expired',metadata:{inputEpoch:0}};
  expect(countConsecutiveInterruptedAttempts([killed,killed,killed],0)).toBe(3);
  expect(countConsecutiveInterruptedAttempts([killed,killed],1)).toBe(0);
  expect(countConsecutiveInterruptedAttempts([killed,{terminal_code:'attempt_budget_handoff'},killed],0)).toBe(1);
 });
});
