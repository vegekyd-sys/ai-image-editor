import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts'))
import monitor_makaron as monitor
import makaron_event_bridge as bridge


def log(rid='request', message='MiniMax invalid task_id (2013)', **kwargs):
    return {'id': rid, 'timestamp': 100000, 'responseStatusCode': 200,
            'requestPath': '/api/cron/video-poll?token=SECRET', 'level': 'error',
            'message': message, **kwargs}


def test_200_error_and_5xx_detection_redacts_payload_and_dynamic_path():
    rows = [log(), log(), log('killed', 'Application exited with code 137 (SIGKILL).'),
            log('server', 'SECRET', responseStatusCode=503),
            log('agent', 'SECRET https://private.test/?token=SECRET',
                requestPath='/api/agent/run/11111111-1111-4111-8111-111111111111?key=SECRET')]
    result = monitor.runtime_errors('\n'.join(json.dumps(r) for r in rows), 50)
    assert len(result) == 4
    assert result[0]['family'] == 'minimax_invalid_task_id'
    assert result[1]['family'] == 'process_killed'
    assert result[2]['family'] == 'http_5xx'
    assert result[3]['path'] == '/api/agent/run/:id'
    assert 'SECRET' not in json.dumps(result) and 'private.test' not in json.dumps(result)


def test_filtered_error_request_with_info_representative_is_not_dropped():
    result = monitor.runtime_errors(json.dumps(log(level='info', message='performance marker')), 50)
    assert len(result) == 1
    assert monitor.runtime_errors(json.dumps(log(level='info')), 50, qualifying_stream=False) == []


def test_error_fingerprint_ignores_request_ids_urls_and_numbers():
    a = 'Provider request 123 failed for https://private.test/a?SECRET'
    b = 'Provider request 456 failed for https://other.test/b?OTHER'
    assert monitor.error_signature(a) == monitor.error_signature(b)


def test_log_service_cap_is_split_and_all_requests_are_retained(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(monitor.time, 'time', lambda: 200)
    def run(argv, **kwargs):
        calls.append(argv)
        if '--status-code' in argv:
            rows = []
        elif len(calls) == 1:
            rows = [log(str(i)) for i in range(50)]
        elif len(calls) == 2:
            rows = [log('late')]
        else:
            rows = [log('early')]
        return SimpleNamespace(returncode=0, stdout='\n'.join(json.dumps(r) for r in rows))
    monkeypatch.setattr(monitor.subprocess, 'run', run)
    check, errors = monitor.read_runtime_logs({'vercel_cli': '/vercel', 'vercel_project_id': 'project'}, 50, tmp_path)
    assert check['ok'] and check['pages'] == 4
    assert len(errors) == 52
    assert all('--no-branch' in c and 'production' in c for c in calls)


def test_saturated_logs_are_explicit_partial_coverage(tmp_path, monkeypatch):
    monkeypatch.setattr(monitor.time, 'time', lambda: 100)
    monkeypatch.setattr(monitor.subprocess, 'run', lambda *a, **kw: SimpleNamespace(
        returncode=0, stdout='\n'.join(json.dumps(log(str(i))) for i in range(50))))
    check, _ = monitor.read_runtime_logs({'vercel_cli': '/vercel', 'vercel_project_id': 'project'}, 99.5, tmp_path)
    assert not check['ok'] and check['coverage'] == 'partial'


def test_failed_log_read_never_advances_watermark_and_eventually_alerts(tmp_path, monkeypatch):
    monkeypatch.setattr(monitor.time, 'time', lambda: 1000)
    monkeypatch.setattr(monitor, 'check_health', lambda *_: [{'name': 'health', 'ok': True}])
    monkeypatch.setattr(monitor, 'read_runtime_logs', lambda *_: ({'name': 'runtime_logs', 'ok': False, 'error': 'unreadable'}, []))
    state = {'logs_covered_until': 900}
    for n in range(3):
        checks, _ = monitor.detect({}, state, tmp_path)
        assert checks[-1]['ok'] == (n < 2)
        assert state['logs_covered_until'] == 900


def test_known_pr_and_repeated_error_do_not_wake_but_new_error_does():
    state = {'tracked_conditions': {'runtime:known': ['https://github.com/owner/repo/pull/1']}}
    known = {'request_id': '1', 'fingerprint': 'known'}
    assert bridge.reconcile(state, [], [known], 100, 'thread') is None
    new = {'request_id': '2', 'fingerprint': 'new'}
    b = bridge.reconcile(state, [], [known, new], 200, 'thread')
    assert b['phase'] == 'pending'
    assert bridge.reconcile(state, [], [known, new], 300, 'thread')['revision'] == 1


def test_recurring_unresolved_error_has_a_24h_model_cooldown():
    state = {}
    error = {'request_id': '1', 'fingerprint': 'family'}
    b = bridge.reconcile(state, [], [error], 100, 'thread')
    b['phase'] = 'completed'
    state['active_batch'] = None
    bridge.reconcile(state, [], [], 200, 'thread')
    assert bridge.reconcile(state, [], [error], 300, 'thread') is None
    bridge.reconcile(state, [], [], 86500, 'thread')
    assert bridge.reconcile(state, [], [error], 86501, 'thread')['phase'] == 'pending'
