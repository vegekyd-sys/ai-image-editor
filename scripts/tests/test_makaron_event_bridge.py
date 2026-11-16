"""No healthy-loop model calls; launched execution is not a handler receipt."""
import json
import plistlib
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
import makaron_event_bridge as bridge


def healthy():
    return [{'name': 'projects', 'ok': True}, {'name': 'media', 'ok': True},
            {'name': 'search_logs', 'ok': True, 'mode': 'passive_real_requests'}]


def error(rid, status=503):
    return {'request_id': rid, 'http': status, 'at': 100, 'path': '/api/agent', 'fingerprint': 'one-error-family'}


def test_healthy_rounds_and_recovery_never_create_model_batch():
    state = {}
    assert bridge.reconcile(state, healthy(), [], 100, 'thread') is None
    assert bridge.reconcile(state, healthy(), [], 200, 'thread') is None
    failed = [*healthy(), {'name': 'projects', 'ok': False, 'error': 'timeout'}]
    b = bridge.reconcile(state, failed, [], 300, 'thread')
    assert b['phase'] == 'pending'
    b['phase'] = 'completed'
    state['active_batch'] = None
    assert bridge.reconcile(state, failed, [], 400, 'thread') is None
    assert bridge.reconcile(state, healthy(), [], 500, 'thread') is None


def test_two_distinct_search_errors_trigger_once_and_merge_new_evidence():
    state = {}
    assert bridge.reconcile(state, healthy(), [], 100, 'thread') is None
    b = bridge.reconcile(state, healthy(), [error('r1'), error('r2')], 200, 'thread')
    assert b['conditions'] == ['runtime:one-error-family']
    bid = b['id']
    b.update(phase='working', receipt_at=200)
    same = bridge.reconcile(state, healthy(), [error('r1'), error('r2'), error('r3')], 300, 'thread')
    assert same['id'] == bid and same['revision'] == 2
    assert len(state['batches']) == 1



def test_dispatch_launches_one_managed_worker_without_marking_received(tmp_path, monkeypatch):
    state = {}
    b = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    calls = []
    def command(argv, *args):
        calls.append((argv, plistlib.loads(Path(argv[-1]).read_bytes())))
        return {'returncode': 0, 'stdout': '', 'stderr': ''}
    monkeypatch.setattr(bridge, 'bounded_command', command)
    config = {'codex_cli': '/codex', 'thread_id': 'thread'}
    bridge.enqueue(state, b, config, tmp_path)
    bridge.enqueue(state, b, config, tmp_path)
    assert len(calls) == 1
    argv, job = calls[0]
    assert argv[:2] == ['/bin/launchctl', 'bootstrap']
    assert job['RunAtLoad'] and job['LaunchOnlyOnce'] and not job['KeepAlive']
    assert job['ProgramArguments'][-2:] == ['--dispatch-id', b['dispatch_id']]
    assert b['phase'] == 'dispatched' and not b['received'] and not b['completed']
    assert b['dispatch_id'] in bridge.handler_message(b, tmp_path)


def test_uncertain_enqueue_is_never_blindly_repeated(tmp_path, monkeypatch):
    state = {}
    b = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    calls = []
    def command(*args):
        calls.append(1)
        return {'returncode': -1, 'error': 'deadline'}
    monkeypatch.setattr(bridge, 'bounded_command', command)
    bridge.enqueue(state, b, {'codex_cli': '/codex', 'thread_id': 'thread'}, tmp_path)
    bridge.enqueue(state, b, {'codex_cli': '/codex', 'thread_id': 'thread'}, tmp_path)
    assert len(calls) == 1 and b['phase'] == 'dispatch_uncertain'


def test_dispatch_id_fences_duplicate_handlers_and_explicit_renewal(tmp_path):
    state = {}
    b = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    b['dispatch_id'] = 'one-attempt'
    args = SimpleNamespace(command='claim', batch=b['id'], dispatch_id=None)
    assert bridge.receipt(state, args, True)['reason'] == 'dispatch_id_required'
    args.dispatch_id = 'one-attempt'
    assert bridge.receipt(state, args, True)['accepted']
    first = b['first_receipt_at']
    assert bridge.receipt(state, args, True)['reason'] == 'already_claimed'
    args.renew = True
    assert bridge.receipt(state, args, True)['accepted']
    assert b['first_receipt_at'] == first


def test_claim_revision_fence_complete_and_late_message_noop(tmp_path):
    state = {}
    b = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    args = SimpleNamespace(command='claim', batch=b['id'])
    assert bridge.receipt(state, args, False)['reason'] == 'disabled'
    assert bridge.receipt(state, args, True)['accepted']
    result = tmp_path / 'result.json'
    result.write_text(json.dumps({'summary': 'reviewed', 'evidence': [], 'unresolved': ['root cause'],
                                 'next_action': 'reproduce'}))
    args = SimpleNamespace(command='complete', batch=b['id'], revision=0, result=result)
    assert not bridge.receipt(state, args, True)['accepted']
    args.revision = b['revision']
    assert bridge.receipt(state, args, True)['accepted']
    assert b['outcome']['unresolved'] == ['root cause']
    assert bridge.receipt(state, args, True)['reason'] == 'completed'


def test_missing_handler_receipt_does_not_mean_repaired():
    state = {}
    b = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    b.update(phase='queued', queued_at=100)
    bridge.reconcile(state, healthy(), [], 281, 'thread')
    assert b['phase'] == 'receipt_timeout'
    assert not b['received'] and not b['completed']


def test_selftest_cannot_swallow_real_incident(tmp_path):
    state = {}
    b = bridge.reconcile(state, [{'name': 'wake_selftest', 'ok': False, 'error': 'synthetic'}], [], 100, 'thread')
    b.update(selftest=True, phase='working', receipt_at=100, received=True)
    state['conditions'] = []
    real = [{'name': 'media', 'ok': False, 'error': 'deadline_exceeded'}]
    bridge.reconcile(state, real, [], 110, 'thread')
    assert len(b['observations']) == 1
    result = tmp_path / 'result.json'
    result.write_text(json.dumps({'summary': 'selftest', 'evidence': [], 'unresolved': [], 'next_action': 'none'}))
    args = SimpleNamespace(command='complete', batch=b['id'], revision=1, result=result)
    assert bridge.receipt(state, args, True)['accepted']
    assert state['active_batch'] != b['id']
    pending = state['batches'][state['active_batch']]
    assert pending['phase'] == 'pending' and pending['conditions'] == ['media:deadline_exceeded']


def test_separate_selftest_receipt_never_clears_real_batch(tmp_path):
    state = {'selftest_batch': 'test', 'batches': {'test': {'id': 'test', 'revision': 1,
             'selftest': True, 'thread_id': 'thread'}}}
    real = bridge.reconcile(state, [{'name': 'media', 'ok': False, 'error': 'timeout'}], [], 100, 'thread')
    assert bridge.receipt(state, SimpleNamespace(command='claim', batch='test'), True)['accepted']
    path = tmp_path / 'test.json'
    path.write_text(json.dumps({'summary': 'test', 'evidence': [], 'unresolved': [], 'next_action': 'none'}))
    args = SimpleNamespace(command='complete', batch='test', revision=1, result=path)
    assert bridge.receipt(state, args, True)['accepted']
    assert state['active_batch'] == real['id'] and not state.get('selftest_batch')


def test_legacy_deferred_evidence_is_merged_into_current_real_batch(tmp_path):
    state = {'selftest_batch': 'test', 'batches': {'test': {'id': 'test', 'selftest': True,
             'thread_id': 'thread', 'revision': 1, 'received': True}}}
    batch = bridge.reconcile(state, healthy(), [error('one')], 100, 'thread')
    state['deferred_observations'] = [{'conditions': ['deferred'], 'at': 90}]
    result = tmp_path / 'result'
    result.write_text(json.dumps(dict(summary='done', evidence=[], unresolved=[], next_action='none')))
    args = SimpleNamespace(command='complete', batch='test', revision=1, result=result)
    assert bridge.receipt(state, args, True)['accepted']
    assert state['active_batch'] == batch['id']
    assert batch['revision'] == 2 and 'deferred' in batch['conditions']


def test_reinstall_retires_only_completed_legacy_labels(monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location('monitor_installer', Path(bridge.__file__).with_name('install-makaron-monitor.py'))
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    def legacy(bid):
        return dict(completed=True, handler_label='com.tianyi.makaron-handler.' + bid)
    state = {'batches': {'old': legacy('old'), 'new': {**legacy('new'), 'one_shot': True},
                         'current': {**legacy('current'), 'completed': False}, 'foreign': legacy('other')}}
    calls = []
    def run(argv, **kw):
        calls.append(argv)
        return SimpleNamespace(returncode=3 if argv[1] == 'bootout' else 113)
    monkeypatch.setattr(installer.subprocess, 'run', run)
    installer.retire_legacy_handlers(state, 'gui/123')
    assert calls == [['/bin/launchctl', cmd, 'gui/123/com.tianyi.makaron-handler.old'] for cmd in ['bootout', 'print']]
    assert all('completed' in b for b in state['batches'].values())


def test_owner_idle_timeout_starts_after_acquiring_slot():
    b = dict(phase='waiting_for_chat_idle', selftest=True, dispatched_at=100, phase_started_at=250)
    bridge.update_timeout(b, 710)
    assert b['phase'] == 'waiting_for_chat_idle'
    bridge.update_timeout(b, 851)
    assert b['phase'] == 'receipt_timeout'


def test_reinstall_defers_while_legacy_worker_finishes(tmp_path):
    import fcntl
    import runpy
    import pytest
    ensure_idle = runpy.run_path(str(Path(bridge.__file__).with_name('install-makaron-monitor.py')))['ensure_handler_idle']
    with (tmp_path / 'handler.lock').open('a') as gate:
        fcntl.flock(gate, fcntl.LOCK_EX)
        with pytest.raises(SystemExit, match='still finishing'):
            ensure_idle(tmp_path)
    ensure_idle(tmp_path)
