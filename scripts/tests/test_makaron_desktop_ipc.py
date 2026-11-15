"""Only the target thread's runtime status is observed; no turn content retained."""
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
from makaron_desktop_ipc import DesktopIPC


def client():
    c = object.__new__(DesktopIPC)
    c.following = 'target'
    c.runtime_status = None
    c.initial_turn_id = None
    return c


def test_snapshot_and_idle_patch_only_observe_target_metadata():
    c = client()
    c.observe_status({'method': 'thread-stream-state-changed', 'params': {
        'conversationId': 'other', 'change': {'type': 'snapshot',
        'conversationState': {'threadRuntimeStatus': {'type': 'idle'}}}}})
    assert c.runtime_status is None
    c.observe_status({'method': 'thread-stream-state-changed', 'params': {
        'conversationId': 'target', 'change': {'type': 'snapshot', 'conversationState': {
            'threadRuntimeStatus': {'type': 'active'},
            'turns': [{'turnId': 'setup-turn', 'status': 'inProgress', 'items': ['SECRET']}],
            'credential': 'SECRET'}}}})
    assert c.runtime_status == 'active' and c.initial_turn_id == 'setup-turn'
    assert 'SECRET' not in str(c.__dict__)
    c.observe_status({'method': 'thread-stream-state-changed', 'params': {
        'conversationId': 'target', 'change': {'type': 'patches', 'patches': [
            {'op': 'replace', 'path': ['threadRuntimeStatus'], 'value': {'type': 'idle'}}]}}})
    assert c.runtime_status == 'idle'


def test_standard_turn_request_preserves_thread_and_does_not_use_unsupported_admission():
    c = client()
    calls = []
    c.request = lambda *a, **kw: calls.append((a, kw)) or {'resultType': 'success'}
    c.start_turn('target', 'owner', 'message', 'one-attempt')
    a, kw = calls[0]
    assert a[0] == 'thread-follower-start-turn' and a[2] == 2
    turn = a[1]['turnStart']
    assert turn['request']['threadId'] == 'target'
    assert turn['request']['clientUserMessageId'] == 'one-attempt'
    assert turn['context'] == {'inheritThreadSettings': True, 'useUserMessageAdmission': False}
    assert kw['timeout'] == 65
