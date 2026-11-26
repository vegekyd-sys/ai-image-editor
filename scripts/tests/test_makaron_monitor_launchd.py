"""Darwin scheduling acceptance with a private socket and a simulated desktop turn."""
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time

import pytest

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
import makaron_event_bridge as bridge
from makaron_export_watch import observe


def send(conn, **frame):
    payload = json.dumps(frame).encode()
    conn.sendall(struct.pack('<I', len(payload)) + payload)


def read(stream):
    size, = struct.unpack('<I', stream.read(4))
    return json.loads(stream.read(size))


@pytest.mark.skipif(sys.platform != 'darwin', reason='requires a macOS GUI launchd domain')
@pytest.mark.parametrize('export_replay', [False, True], ids=['runtime', '29-project-export'])
def test_error_starts_one_owner_turn_through_launchd_and_completes_latest_revision(monkeypatch, export_replay):
    domain = subprocess.run(['/bin/launchctl', 'print', f'gui/{os.getuid()}'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if domain.returncode:
        pytest.skip('no GUI launchd domain for this user')
    # launchd runs the candidate files. The only endpoints in this fixture are
    # the temporary state and this Unix socket; there is no real Codex CLI.
    with tempfile.TemporaryDirectory(prefix='makaron-test-', dir='/tmp') as tmp, socket.socket(socket.AF_UNIX) as server:
        directory = Path(tmp)
        for name in ('makaron_event_worker.py', 'makaron_event_bridge.py', 'makaron_desktop_ipc.py', 'monitor_makaron.py',
                     'makaron_export_watch.py'):
            shutil.copyfile(Path(bridge.__file__).with_name(name), directory / name)
        sock = str(directory / 'ipc.sock')
        server.bind(sock)
        server.listen()
        server.settimeout(10)
        config = dict(thread_id='fixture', desktop_ipc_socket=sock, handler_cwd=tmp, codex_cli='/no-cli')
        (directory / 'bridge-config.json').write_text(json.dumps(config))
        path = directory / 'bridge-state.json'
        path.write_text(json.dumps({'enabled': True}))
        tick = 0
        errors = [] if export_replay else [dict(request_id='request-1', fingerprint='test-error')]
        fixture = json.loads(Path(__file__).with_name('fixtures').joinpath('makaron-export-validation-replay.json').read_text())
        def export_poll(config, state, now):
            if export_replay:
                rows = [dict(at=t/1000, id=str(i), project_id=str(project), family='media_validation')
                        for i, (t, project) in enumerate(fixture['failed_jobs']) if tick-240 <= t/1000 <= tick]
                observe(state, rows, tick, 'fixture')
            return {'name': 'export_jobs', 'ok': True}
        monkeypatch.setattr(bridge, 'poll_exports', export_poll)
        monkeypatch.setattr(bridge, 'detect', lambda *a: ([], errors))
        monkeypatch.setattr(sys, 'argv', ['bridge', '--directory', tmp, 'tick'])
        if export_replay:
            for tick in range(0, 2640, 120):
                assert bridge.main() == 0
                assert not json.loads(path.read_text()).get('export_alert_batches')
            tick = 2640
        assert bridge.main() == 0
        s = json.loads(path.read_text())
        bid = s['export_alert_batches'][0] if export_replay else s['active_batch']
        b = s['batches'][bid]
        token = b['dispatch_id']
        assert b['dispatch_result']['returncode'] == 0
        target = f"gui/{os.getuid()}/{b['handler_label']}"

        def receipt(action, *args):
            output = subprocess.check_output(['/usr/bin/python3', str(directory / 'makaron_event_bridge.py'),
                '--directory', tmp, action, '--batch', bid, '--dispatch-id', token, *args])
            return json.loads(output)

        def registered():
            probe = subprocess.run(['/bin/launchctl', 'print', target], capture_output=True)
            return probe.returncode == 0

        try:
            conn, _ = server.accept()
            conn.settimeout(10)
            with conn, conn.makefile('rb') as stream:
                for method, fields in [
                        ('initialize', {'result': {'clientId': 'monitor'}}),
                        ('thread-owner-discovery', {'handledByClientId': 'owner'})]:
                    req = read(stream)
                    assert req['method'] == method
                    send(conn, type='response', requestId=req['requestId'], resultType='success', **fields)
                assert read(stream)['params']['following']
                send(conn, method='thread-stream-state-changed', params={'conversationId': 'fixture',
                     'change': {'type': 'snapshot', 'conversationState': {'threadRuntimeStatus': {'type': 'active'},
                     'turns': [{'turnId': 'setup', 'status': 'inProgress'}]}}})
                # A discovery round-trip proves the busy snapshot was processed before idle.
                send(conn, type='client-discovery-request', requestId='probe')
                assert read(stream)['type'] == 'client-discovery-response'
                send(conn, method='thread-stream-state-changed', params={'conversationId': 'fixture',
                     'change': {'type': 'patches', 'patches': [{'path': ['threadRuntimeStatus', 'type'], 'value': 'idle'}]}})
                assert not read(stream)['params']['following']
                start = read(stream)
                request = start['params']['turnStart']['request']
                assert start['method'] == 'thread-follower-start-turn' and start['targetClientId'] == 'owner'
                assert request['threadId'] == 'fixture' and request['clientUserMessageId'] == token
                assert request['input'][0]['text'].startswith(f'[Makaron Monitor batch={bid}]')
                if export_replay:
                    assert '3 个不同项目' in request['input'][0]['text']
                send(conn, type='response', requestId=start['requestId'], resultType='success',
                     result={'turn': {'id': 'incident-turn'}})
                assert stream.read(1) == b''

            claim = receipt('claim')
            assert claim['accepted'] and not receipt('claim')['accepted']
            deadline = time.monotonic() + 10
            while registered() and time.monotonic() < deadline:
                time.sleep(0.05)
            assert not registered()
            b = json.loads(path.read_text())['batches'][bid]
            assert b['phase'] == 'working' and b['worker']['finished_at'] and not b['completed']
            assert b['worker']['native_turn_id'] == 'incident-turn'
            outcome = directory / 'outcome.json'
            outcome.write_text(json.dumps(dict(summary='done', evidence=[], unresolved=[], next_action='none')))
            if export_replay:
                assert receipt('complete', '--result', str(outcome), '--revision', '1')['accepted']
                for tick in range(2760, 20000, 120):
                    bridge.main()
            else:
                errors.append(dict(request_id='request-2', fingerprint='test-error'))
                bridge.main()
                stale = receipt('complete', '--result', str(outcome), '--revision', '1')
                assert not stale['accepted'] and stale['revision'] == 2
                assert receipt('claim', '--renew')['batch']['first_receipt_at'] == claim['batch']['first_receipt_at']
                assert receipt('complete', '--result', str(outcome), '--revision', '2')['accepted']
                bridge.main()  # same error
                errors.clear()
                bridge.main()  # recovery
                errors.append(dict(request_id='request-3', fingerprint='test-error'))
                bridge.main()  # recurrence within cooldown
            assert receipt('claim')['reason'] == 'completed'
            s = json.loads(path.read_text())
            assert not s.get('active_batch') and not s.get('export_alert_batches') and list(s['batches']) == [bid]
            assert s['batches'][bid]['phase'] == 'completed'
            server.setblocking(False)
            with pytest.raises(BlockingIOError):
                server.accept()
        finally:
            if registered():
                subprocess.run(['/bin/launchctl', 'bootout', target], check=True, capture_output=True)
