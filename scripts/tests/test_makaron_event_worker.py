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
