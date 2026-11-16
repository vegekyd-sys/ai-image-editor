"""Worker lifecycle and redaction tests; real-model acceptance is separate."""
import io
import json
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
import makaron_event_worker as worker


def test_command_resumes_exact_thread_without_daemon_queue_or_model_override(tmp_path):
    cfg = {'codex_cli': '/codex', 'handler_cwd': str(tmp_path), 'thread_id': 'original'}
    cmd = worker.command(cfg, tmp_path)
    assert cmd[:3] == ['/codex', '--no-daemon', 'exec']
    assert cmd[-3:] == ['resume', 'original', '-']
    assert 'queue' not in cmd and '--model' not in cmd and 'fork' not in cmd


def test_event_observer_retains_identity_and_usage_never_content():
    lines = [
        {'type': 'thread.started', 'thread_id': 'original'},
        {'type': 'turn.started'},
        {'type': 'item.completed', 'item': {'type': 'command_execution', 'aggregated_output': 'SECRET'}},
        {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'SECRET'}},
        {'type': 'turn.completed', 'usage': {'input_tokens': 1, 'output_tokens': 2, 'secret': 'SECRET'}},
    ]
    stream = io.BytesIO(('\n'.join(json.dumps(x) for x in lines) + '\n').encode())
    facts, mismatch = {}, threading.Event()
    worker.observe_events(stream, 'original', facts, mismatch)
    assert facts['thread_matched'] and not mismatch.is_set()
    assert facts['usage'] == {'input_tokens': 1, 'output_tokens': 2}
    assert 'SECRET' not in json.dumps(facts)


def test_wrong_thread_stops_execution():
    facts, stop = {}, threading.Event()
    worker.observe_events(io.BytesIO(b'{"type":"thread.started","thread_id":"wrong"}\n'),
                          'original', facts, stop)
    assert stop.is_set() and not facts['thread_matched']


def test_existing_desktop_owner_is_used_without_attempting_a_second_writer(tmp_path, monkeypatch):
    socket = tmp_path / 'ipc.sock'
    socket.touch()
    calls = []
    class Client:
        initial_turn_id = 'setup-turn'
        def __init__(self, path): pass
        def owner(self, thread):
            calls.append(('owner', thread))
            return 'actual-owner'
        def wait_idle(self, *args): pass
        def start_turn(self, thread, owner, message, token):
            calls.append(('start', thread, owner, token))
            return {'resultType': 'success', 'result': {'result': {'turn': {'id': 'new-turn'}}}}
        def close(self): pass
    monkeypatch.setattr(worker, 'DesktopIPC', Client)
    facts = {}
    assert worker.desktop_dispatch({'desktop_ipc_socket': str(socket), 'thread_id': 'original'},
                                   'message', 'one-attempt', facts)
    assert facts['transport'] == 'desktop_owner_native_turn'
    assert facts['native_accepted'] and facts['native_turn_id'] == 'new-turn'
    assert calls == [('owner', 'original'), ('start', 'original', 'actual-owner', 'one-attempt')]


def test_ambiguous_native_submission_cannot_fall_back_to_duplicate_cli(tmp_path, monkeypatch):
    socket = tmp_path / 'ipc.sock'
    socket.touch()
    class Client:
        initial_turn_id = 'setup-turn'
        def __init__(self, path): pass
        def owner(self, thread): return 'actual-owner'
        def wait_idle(self, *args): pass
        def start_turn(self, *args): raise TimeoutError('potentially accepted')
        def close(self): pass
    monkeypatch.setattr(worker, 'DesktopIPC', Client)
    facts = {}
    assert worker.desktop_dispatch({'desktop_ipc_socket': str(socket), 'thread_id': 'original'},
                                   'message', 'one-attempt', facts)
    assert facts['native_submission_unconfirmed'] == 'TimeoutError'


def test_stderr_diagnostics_are_bounded_and_do_not_store_secrets():
    facts = {}
    worker.drain_stderr(io.BytesIO(b'Error: thread-store conflict: active writer\n'
                                   b'Error: bearer SECRET\n'
                                   b'Error: failed [URL] https://example.test/private?key=SECRET\n'), facts)
    assert any('active writer' in s for s in facts['startup_diagnostics'])
    assert 'SECRET' not in json.dumps(facts)


def test_worker_requires_real_receipts_and_does_not_repeat_completed_batch(tmp_path, monkeypatch):
    import makaron_event_bridge as bridge
    monkeypatch.setattr(worker.signal, 'signal', lambda *args: None)
    batch = {'id': 'test', 'thread_id': 'original', 'selftest': True,
             'dispatch_id': 'attempt', 'dispatched_at': 100, 'phase': 'dispatched',
             'revision': 1, 'received': False, 'completed': False}
    state = {'enabled': True, 'selftest_batch': 'test', 'batches': {'test': batch}}
    (tmp_path / 'bridge-state.json').write_text(json.dumps(state))
    cli = tmp_path / 'fake-codex'
    scripts = Path(bridge.__file__).parent
    cli.write_text(f'''#!/usr/bin/python3
import sys,json,pathlib
from types import SimpleNamespace
sys.path.insert(0,{str(scripts)!r})
import makaron_event_bridge as b
d=pathlib.Path({str(tmp_path)!r});p=d/'bridge-state.json'
sys.stdin.read()
print(json.dumps({{'type':'thread.started','thread_id':'original'}}),flush=True)
print(json.dumps({{'type':'turn.started'}}),flush=True)
s=json.loads(p.read_text());args=SimpleNamespace(command='claim',batch='test',dispatch_id='attempt')
assert b.receipt(s,args,True)['accepted'];p.write_text(json.dumps(s))
r=d/'result.json';r.write_text(json.dumps(dict(summary='test',evidence=[],unresolved=[],next_action='none')))
args=SimpleNamespace(command='complete',batch='test',dispatch_id='attempt',revision=1,result=r)
assert b.receipt(s,args,True)['accepted'];p.write_text(json.dumps(s))
print(json.dumps({{'type':'turn.completed','usage':{{'input_tokens':1,'output_tokens':1}}}}),flush=True)
''')
    cli.chmod(0o700)
    (tmp_path / 'bridge-config.json').write_text(json.dumps({
        'codex_cli': str(cli), 'handler_cwd': str(tmp_path), 'thread_id': 'original',
        'desktop_ipc_socket': str(tmp_path / 'absent.sock')}))
    assert worker.run(tmp_path, 'test', 'attempt') == 0
    acceptance = json.loads((tmp_path / 'wake-acceptance-test.json').read_text())
    assert acceptance['passed'] and acceptance['worker']['thread_matched']
    assert acceptance['makaron_probes_by_selftest'] == 0
    assert worker.run(tmp_path, 'test', 'attempt') == 0
    assert json.loads((tmp_path / 'wake-acceptance-test.json').read_text()) == acceptance


def isolated_state(directory, phase='dispatched', **fields):
    batch = dict(id='batch', thread_id='thread', dispatch_id='first', dispatched_at=100,
                 revision=1, phase=phase, conditions=['error'], observations=[], one_shot=True)
    batch.update(fields)
    (directory / 'bridge-config.json').write_text(json.dumps({
        'thread_id': 'thread', 'desktop_ipc_socket': str(directory / 'absent.sock'),
        'handler_cwd': str(directory), 'codex_cli': str(directory / 'unused')}))
    state = {'enabled': True, 'active_batch': 'batch', 'batches': {'batch': batch}}
    (directory / 'bridge-state.json').write_text(json.dumps(state))
    return state


def test_completed_duplicate_never_contends_for_handler_slot(tmp_path):
    import fcntl
    isolated_state(tmp_path, phase='completed', completed=True, received=True, worker={'native_accepted': True})
    path = tmp_path / 'bridge-state.json'
    before = path.stat().st_ino, path.read_bytes()
    with (tmp_path / 'handler.lock').open('a') as gate:
        fcntl.flock(gate, fcntl.LOCK_EX)
        assert worker.run(tmp_path, 'batch', 'first') == 0
    assert (path.stat().st_ino, path.read_bytes()) == before


def test_slot_timeout_races_with_claim_and_completion(tmp_path, monkeypatch):
    import fcntl
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path)
    path = tmp_path / 'bridge-state.json'
    outcome = tmp_path / 'outcome'
    outcome.write_text(json.dumps(dict(summary='ok', evidence=[], unresolved=[], next_action='done')))
    def clock():
        nonlocal calls
        calls += 1
        if calls == 2:  # Just after the waiter's eligibility check, before its timeout write.
            with worker.state_lock(tmp_path):
                s = json.loads(path.read_text())
                args = SimpleNamespace(batch='batch', dispatch_id='first', command='claim')
                assert bridge.receipt(s, args, True)['accepted']
                args.command, args.revision, args.result = 'complete', 1, outcome
                assert bridge.receipt(s, args, True)['accepted']
                path.write_text(json.dumps(s))
            return 181
        return 0
    calls = 0
    monkeypatch.setattr(worker.time, 'monotonic', clock)
    with (tmp_path / 'handler.lock').open('a') as gate:
        fcntl.flock(gate, fcntl.LOCK_EX)
        assert worker.run(tmp_path, 'batch', 'first') == 0
    b = json.loads(path.read_text())['batches']['batch']
    assert b['completed'] and b['phase'] == 'completed' and 'error' not in b['worker']


def test_slot_failure_retry_fences_old_worker_and_receipts(tmp_path, monkeypatch):
    import fcntl
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path)
    path = tmp_path / 'bridge-state.json'
    with (tmp_path / 'handler.lock').open('a') as gate, monkeypatch.context() as patch:
        fcntl.flock(gate, fcntl.LOCK_EX)
        patch.setattr(worker.time, 'monotonic', iter([0, 181]).__next__)
        assert worker.run(tmp_path, 'batch', 'first') == 2
    args = SimpleNamespace(command='claim', batch='batch', dispatch_id='first')
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    state = json.loads(path.read_text())
    assert bridge.retry_dispatch(state, args, {}, tmp_path)['accepted']
    b = state['batches']['batch']
    assert b['dispatch_id'] != 'first' and b['previous_dispatches'][0]['worker']['error'] == 'handler_slot_timeout'
    original = path.read_bytes()
    assert worker.run(tmp_path, 'batch', 'first') == 0 and original == path.read_bytes()
    assert not bridge.receipt(state, args, True)['accepted']
    assert not bridge.retry_dispatch(state, args, {}, tmp_path)['accepted']


def test_old_worker_cannot_submit_on_owner_idle_after_dispatch_replaced(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path)
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    path = tmp_path / 'bridge-state.json'
    submissions = []
    def desktop(config, message, token, facts, cancelled, progress, enabled, timeout):
        progress('waiting_for_chat_idle', facts)
        with worker.state_lock(tmp_path):
            state = json.loads(path.read_text())
            current = state['batches']['batch']
            bridge.update_timeout(current, current['phase_started_at'] + 3601)
            assert bridge.retry_dispatch(state, SimpleNamespace(batch='batch', dispatch_id='first'), {}, tmp_path)['accepted']
        assert not enabled()
        progress('executing', facts)
        submissions.append(token)
        return True
    monkeypatch.setattr(worker, 'desktop_dispatch', desktop)
    assert worker.run(tmp_path, 'batch', 'first') == 2
    b = json.loads(path.read_text())['batches']['batch']
    assert submissions == []
    assert b['phase'] == 'dispatched' and 'worker' not in b and 'model_requested_at' not in b


def test_owner_handoff_and_lost_reply_both_release_slot_without_replay(tmp_path, monkeypatch):
    import fcntl
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    for reply in ('native_accepted', 'native_submission_unconfirmed'):
        isolated_state(tmp_path)
        path = tmp_path / 'bridge-state.json'
        calls = []
        def desktop(config, message, token, facts, cancelled, progress, enabled, timeout):
            progress('executing', facts)
            calls.append(token)
            # A second launch while the original is in start_turn.
            assert worker.run(tmp_path, 'batch', token) == 0
            facts[reply] = True
            return True
        monkeypatch.setattr(worker, 'desktop_dispatch', desktop)
        assert worker.run(tmp_path, 'batch', 'first') == 0
        assert calls == ['first']
        with (tmp_path / 'handler.lock').open('a') as gate:
            fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
        s = json.loads(path.read_text())
        b = s['batches']['batch']
        assert b['phase'] == 'executing' and not b.get('received') and b['worker'][reply]
        bridge.update_timeout(b, b['model_requested_at'] + 181)
        args = SimpleNamespace(batch='batch', dispatch_id='first', command='claim')
        assert b['phase'] == 'receipt_timeout' and not bridge.retry_dispatch(s, args, {}, tmp_path)['accepted']
        assert bridge.receipt(s, args, True)['accepted'] and b['phase'] == 'working'


def test_selftest_observer_timeout_keeps_claim_and_releases_slot(tmp_path, monkeypatch):
    import fcntl
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path, selftest=True)
    path = tmp_path / 'bridge-state.json'
    def desktop(config, message, token, facts, cancelled, progress, enabled, timeout):
        progress('executing', facts)
        s = json.loads(path.read_text())
        assert bridge.receipt(s, SimpleNamespace(batch='batch', dispatch_id=token, command='claim'), True)['accepted']
        path.write_text(json.dumps(s))
        facts['native_accepted'] = True
        return True
    monkeypatch.setattr(worker, 'desktop_dispatch', desktop)
    unlocked = []
    times = iter([0, 0, 601])
    def clock():
        now = next(times)
        if now == 601:
            with (tmp_path / 'handler.lock').open('a') as gate:
                fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                unlocked.append(True)
        return now
    monkeypatch.setattr(worker.time, 'monotonic', clock)
    assert worker.run(tmp_path, 'batch', 'first') == 2
    assert json.loads(path.read_text())['batches']['batch']['phase'] == 'working'
    assert unlocked == [True]
    assert not json.loads((tmp_path / 'wake-acceptance-batch.json').read_text())['passed']


def test_unstartable_cli_can_retry_and_archives_failed_selftest(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path, selftest=True)
    path = tmp_path / 'bridge-state.json'
    assert worker.run(tmp_path, 'batch', 'first') == 2
    s = json.loads(path.read_text())
    b = s['batches']['batch']
    assert b['phase'] == 'handler_failed' and b['worker']['cli_not_started'] and 'model_requested_at' not in b
    previous = tmp_path / 'wake-acceptance-batch.json'
    evidence = previous.read_bytes()
    monkeypatch.setattr(bridge, 'bounded_command', lambda *a: {'returncode': 0})
    assert bridge.retry_dispatch(s, SimpleNamespace(batch='batch', dispatch_id='first'), {}, tmp_path)['accepted']
    assert not previous.exists()
    assert (tmp_path / 'wake-acceptance-batch-first.json').read_bytes() == evidence
    assert b['previous_dispatches'][0]['worker']['launch_error_type'] == 'FileNotFoundError'


def test_cli_exit_after_claim_is_failure_and_retains_late_completion(tmp_path):
    from types import SimpleNamespace
    import makaron_event_bridge as bridge
    isolated_state(tmp_path)
    config = json.loads((tmp_path / 'bridge-config.json').read_text())
    cli = Path(config['codex_cli'])
    cli.write_text(f"""#!/usr/bin/python3
import json, sys, subprocess
sys.stdin.read()
claim = subprocess.check_output(['/usr/bin/python3', {bridge.__file__!r}, '--directory', {str(tmp_path)!r},
                                 'claim', '--batch', 'batch', '--dispatch-id', 'first'])
assert json.loads(claim)['accepted']
sys.exit(7)
""")
    cli.chmod(0o700)
    assert worker.run(tmp_path, 'batch', 'first') == 2
    s = json.loads((tmp_path / 'bridge-state.json').read_text())
    b = s['batches']['batch']
    assert b['received'] and b['first_receipt_at'] and b['worker']['cli_exit_code'] == 7
    assert b['phase'] == 'handler_failed' and not b.get('completed')
    args = SimpleNamespace(command='complete', batch='batch', dispatch_id='first', revision=1, result=tmp_path / 'outcome')
    assert not bridge.retry_dispatch(s, args, {}, tmp_path)['accepted']
    args.result.write_text(json.dumps(dict(summary='recovered', evidence=[], unresolved=[], next_action='done')))
    assert bridge.receipt(s, args, True)['accepted'] and b['phase'] == 'completed'
