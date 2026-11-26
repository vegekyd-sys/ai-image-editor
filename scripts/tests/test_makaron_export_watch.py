import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
import makaron_event_bridge as bridge
import makaron_export_watch as watch
from makaron_event_worker import executable_batch


def test_replay_old_exports_through_dispatch_receipts_and_restart(tmp_path, monkeypatch):
    fixture = json.loads(Path(__file__).with_name('fixtures').joinpath('makaron-export-validation-replay.json').read_text())
    start = fixture['start_unix']
    rows = [dict(at=start + elapsed / 1000, id=str(i), project_id=str(project), family='media_validation')
            for i, (elapsed, project) in enumerate(fixture['failed_jobs'])]
    assert len(rows) == 59 and len({r['project_id'] for r in rows}) == 29
    state = dict(enabled=True, active_batch='busy', batches={'busy': dict(id='busy', phase='working')})
    ticks = []
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    result = tmp_path / 'result'
    result.write_text(json.dumps(dict(summary='notified', evidence=[], unresolved=[], next_action='none')))
    for tick in range(start, int(rows[-1]['at']) + 4000, 120):
        window = [r for r in rows if tick - 240 <= r['at'] <= tick]
        watch.observe(state, window, tick, 'original-thread')
        for bid in list(state.get('export_alert_batches', [])):
            batch = state['batches'][bid]
            bridge.dispatch_on_tick(state, batch, {}, tmp_path, tick)
            args = SimpleNamespace(batch=bid, dispatch_id=batch['dispatch_id'], command='claim')
            assert executable_batch(state, batch) and bridge.receipt(state, args, True)['accepted']
            assert not bridge.receipt(state, args, True)['accepted']
            assert '原聊天提醒用户一次' in bridge.handler_message(batch, tmp_path)
            args.command, args.revision, args.result = 'complete', batch['revision'], result
            assert bridge.receipt(state, args, True)['accepted']
            ticks.append((tick, batch['export_alert']['at']))
        state = json.loads(json.dumps(state))  # next launchd invocation
    assert ticks == [(start + 2640, start + 2594.980)]
    assert state['active_batch'] == 'busy' and len(state['batches']) == 2
    assert not state['export_failure_families']


def test_independent_causes_quiet_gap_and_single_project_retries():
    state = {}
    def add(at, family, project):
        watch.observe(state, [dict(at=at, family=family, project_id=project, id=str(at))], at, 'thread')
    for i in range(6):
        add(i, 'a', 1)
    add(7, 'b', 2)
    add(8, 'a', 2)
    assert not state.get('export_alert_batches')
    add(9, 'a', 3)
    add(10, 'b', 3)
    add(11, 'b', 4)
    assert len(state['export_alert_batches']) == 2
    for i in range(3):
        add(3700+i, 'a', i)
    assert len(state['export_alert_batches']) == 3


def test_retry_reaped_unclaimed_cli_and_fence_late_receipts(tmp_path, monkeypatch):
    batch = dict(id='b', phase='handler_failed', dispatch_id='old', dispatched_at=100,
                 received=False, completed=False, one_shot=True, model_requested_at=101,
                 worker=dict(transport='launchd_exec_resume_no_daemon', dispatch_id='old',
                             cli_pid=1001, cli_exit_code=1, finished_at='done'))
    state = dict(enabled=True, active_batch='b', batches={'b': batch})
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    for key, value in [('dispatch_id','other'),('transport','desktop_owner_native_turn'),('cli_exit_code',None)]:
        before = batch['worker'][key]
        batch['worker'][key] = value
        bridge.dispatch_on_tick(state, batch, {}, tmp_path, 300)
        assert batch['dispatch_id'] == 'old'
        batch['worker'][key] = before
    batch['received'] = True
    bridge.dispatch_on_tick(state, batch, {}, tmp_path, 300)
    assert batch['dispatch_id'] == 'old'
    batch['received'] = False
    bridge.dispatch_on_tick(state, batch, {}, tmp_path, 300)
    assert batch['phase'] == 'dispatched' and batch['dispatch_id'] != 'old'
    assert 'model_requested_at' not in batch
    for action in ['claim','complete']:
        assert not bridge.receipt(state, SimpleNamespace(batch='b',dispatch_id='old',command=action), True)['accepted']
    assert bridge.receipt(state, SimpleNamespace(batch='b',dispatch_id=batch['dispatch_id'],command='claim'), True)['accepted']


def test_missing_cli_and_worker_only_retry_after_both_are_gone(tmp_path, monkeypatch):
    b = dict(id='b', phase='receipt_timeout', received=False, completed=False, one_shot=True,
             dispatched_at=0, dispatch_id='old', model_requested_at=10,
             worker=dict(transport='launchd_exec_resume_no_daemon', dispatch_id='old', cli_pid=41,worker_pid=42))
    state = dict(enabled=True,active_batch='b',batches={'b':b})
    live = {41,42}
    def probe(pid, sig):
        assert sig == 0
        if pid not in live:
            raise ProcessLookupError
    monkeypatch.setattr(bridge.os,'kill',probe)
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    for pid in [42,41]:
        bridge.dispatch_on_tick(state,b,{},tmp_path,300)
        assert b['dispatch_id'] == 'old'
        live.remove(pid)
    bridge.dispatch_on_tick(state,b,{},tmp_path,300)
    assert b['dispatch_id'] != 'old'
