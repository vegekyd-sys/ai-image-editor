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


def send(conn, **frame):
    payload = json.dumps(frame).encode()
    conn.sendall(struct.pack('<I', len(payload)) + payload)


def read(stream):
    size, = struct.unpack('<I', stream.read(4))
    return json.loads(stream.read(size))


@pytest.mark.skipif(sys.platform != 'darwin', reason='requires a macOS GUI launchd domain')
def test_error_starts_one_owner_turn_through_launchd_and_completes_latest_revision(monkeypatch):
    # launchd runs the candidate files. The only endpoints in this fixture are
    # the temporary state and this Unix socket; there is no real Codex CLI.
    with tempfile.TemporaryDirectory(prefix='makaron-test-', dir='/tmp') as tmp, socket.socket(socket.AF_UNIX) as server:
        directory = Path(tmp)
        for name in ('makaron_event_worker.py', 'makaron_event_bridge.py', 'makaron_desktop_ipc.py', 'monitor_makaron.py'):
            shutil.copyfile(Path(bridge.__file__).with_name(name), directory / name)
        sock = str(directory / 'ipc.sock')
        server.bind(sock)
        server.listen()
        server.settimeout(10)
        config = dict(thread_id='fixture', desktop_ipc_socket=sock, handler_cwd=tmp, codex_cli='/no-cli')
        (directory / 'bridge-config.json').write_text(json.dumps(config))
        path = directory / 'bridge-state.json'
        path.write_text(json.dumps({'enabled': True}))
        errors = [dict(request_id='request-1', fingerprint='test-error')]
        monkeypatch.setattr(bridge, 'detect', lambda *a: ([], errors))
        monkeypatch.setattr(sys, 'argv', ['bridge', '--directory', tmp, 'tick'])
        assert bridge.main() == 0
        s = json.loads(path.read_text())
        bid = s['active_batch']
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
            errors.append(dict(request_id='request-2', fingerprint='test-error'))
            bridge.main()
            outcome = directory / 'outcome.json'
            outcome.write_text(json.dumps(dict(summary='done', evidence=[], unresolved=[], next_action='none')))
            stale = receipt('complete', '--result', str(outcome), '--revision', '1')
            assert not stale['accepted'] and stale['revision'] == 2
            assert receipt('claim', '--renew')['batch']['first_receipt_at'] == claim['batch']['first_receipt_at']
            assert receipt('complete', '--result', str(outcome), '--revision', '2')['accepted']
            assert receipt('claim')['reason'] == 'completed'
            bridge.main()  # same error
            errors.clear()
            bridge.main()  # recovery
            errors.append(dict(request_id='request-3', fingerprint='test-error'))
            bridge.main()  # recurrence within cooldown
            s = json.loads(path.read_text())
            assert s['active_batch'] is None and list(s['batches']) == [bid]
            assert len(s['seen_error_keys']) == 3 and s['batches'][bid]['phase'] == 'completed'
            server.setblocking(False)
            with pytest.raises(BlockingIOError):
                server.accept()
        finally:
            if registered():
                subprocess.run(['/bin/launchctl', 'bootout', target], check=True, capture_output=True)
