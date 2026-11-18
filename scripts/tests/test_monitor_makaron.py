import json
from io import BytesIO

import pytest
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


def request_row(rid='request', message='MiniMax invalid task_id (2013)', **kwargs):
    return {'requestId': rid, 'timestamp': 100000, 'statusCode': 200,
            'requestPath': '/api/cron/video-poll', 'logs': [{'level': 'error', 'message': message}], **kwargs}


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
    def fetch(config, start, end, selector, page):
        calls.append((config, selector, page))
        if selector.get('statusCode'):
            rows = []
        elif len(calls) == 1:
            rows = [request_row(str(i)) for i in range(50)]
        elif len(calls) == 2:
            rows = [request_row('late')]
        else:
            rows = [request_row('early')]
        return {'rows': rows, 'hasMoreRows': False}
    monkeypatch.setattr(monitor, 'fetch_log_page', fetch)
    check, errors = monitor.read_runtime_logs({'vercel_cli': '/vercel', 'vercel_project_id': 'project'}, 50, tmp_path)
    assert check['ok'] and check['pages'] == 4
    assert len(errors) == 52
    assert calls[-1][1] == {'statusCode': '5xx'} and calls[0][1] == {'level': 'error'}


def test_saturated_logs_are_explicit_partial_coverage(tmp_path, monkeypatch):
    monkeypatch.setattr(monitor.time, 'time', lambda: 100)
    monkeypatch.setattr(monitor, 'fetch_log_page', lambda *a, **kw: {
        'rows': [request_row(str(i)) for i in range(50)], 'hasMoreRows': False})
    check, _ = monitor.read_runtime_logs({'vercel_cli': '/vercel', 'vercel_project_id': 'project'}, 99.5, tmp_path)
    assert not check['ok'] and check['coverage'] == 'partial'


def test_actual_errors_with_identical_info_first_lines_have_distinct_fingerprints():
    def row(rid, error):
        return request_row(rid, requestPath='/api/agent/run', timestamp='1970-01-01T00:01:40Z', logs=[
            {'level': 'info', 'message': '[agent-perf] start'}, {'level': 'error', 'message': error}])
    rows = [row('message', '[DualWriter] message upsert error: code 57014 statement timeout'),
            row('workspace', '[workspace] list error: canceling statement due to statement timeout')]
    errors = monitor.request_errors(rows, 50)
    assert {e['family'] for e in errors} == {'message_write_timeout', 'workspace_list_timeout'}
    assert errors[0]['fingerprint'] != errors[1]['fingerprint']
    assert 'agent-perf' not in json.dumps(errors)


def test_multiple_distinct_errors_in_one_request_are_not_discarded():
    row = request_row(logs=[{'level': 'error', 'message': '[workspace] list error: statement timeout'},
        {'level': 'error', 'message': '[DualWriter] message upsert error: 57014'}])
    assert len(monitor.request_errors([row], 50)) == 2


def test_later_error_in_same_request_keeps_its_own_evidence():
    state = {}
    first = {'request_id': 'same-request', 'fingerprint': 'first'}
    second = {'request_id': 'same-request', 'fingerprint': 'second'}
    batch = bridge.reconcile(state, [], [first], 100, 'thread')
    bridge.reconcile(state, [], [first, second], 101, 'thread')
    assert batch['revision'] == 2
    assert batch['observations'][-1]['new_runtime_errors'] == [second]


def test_confirmed_recovered_client_report_does_not_wake_but_real_5xx_stays_visible():
    report = '[remotion-client-error] ' + json.dumps({'recovered': True, 'message': 'SECRET'})
    row = request_row(message=report, requestPath='/api/remotion/client-error')
    assert monitor.request_errors([row], 50) == []
    row['statusCode'] = 503
    errors = monitor.request_errors([row], 50)
    assert len(errors) == 1 and errors[0]['family'] == 'http_5xx'
    assert 'SECRET' not in json.dumps(errors)


def test_missing_error_detail_is_still_a_signal_and_pagination_is_followed(tmp_path, monkeypatch):
    calls = []
    def fetch(config, start, end, selector, page):
        calls.append((selector, page))
        if selector.get('statusCode'):
            return {'rows': [], 'hasMoreRows': False}
        return {'rows': [request_row(str(page), logs=[])], 'hasMoreRows': page == 0}
    monkeypatch.setattr(monitor, 'fetch_log_page', fetch)
    check, errors = monitor.read_runtime_logs({}, 50, tmp_path)
    assert check['ok'] and len(errors) == 2
    assert calls[:2] == [({'level': 'error'}, 0), ({'level': 'error'}, 1)]


def test_log_transport_failure_keeps_partial_coverage_without_raw_errors(tmp_path, monkeypatch):
    def fetch(*args):
        raise ValueError('SECRET URL or response')
    monkeypatch.setattr(monitor, 'fetch_log_page', fetch)
    check, _ = monitor.read_runtime_logs({}, 50, tmp_path)
    assert not check['ok'] and check['coverage'] == 'partial'
    assert 'SECRET' not in json.dumps(check)


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


def test_completion_links_only_fixed_condition_and_preserves_existing_pr(tmp_path):
    state = {'tracked_conditions': {'runtime:known': ['old-pr']}}
    errors = [{'request_id': f'r{i}', 'fingerprint': name} for i, name in enumerate(['known', 'fixed', 'external'])]
    batch = bridge.reconcile(state, [], errors, 100, 'thread')
    batch['received'] = True
    result = tmp_path / 'result.json'
    result.write_text(json.dumps({'summary': 'candidate', 'evidence': [], 'unresolved': ['external'],
        'next_action': 'review', 'pull_requests': ['new-pr'],
        'condition_pull_requests': {'runtime:fixed': ['new-pr']}}))
    args = SimpleNamespace(command='complete', batch=batch['id'], revision=batch['revision'], result=result)
    assert bridge.receipt(state, args, True)['accepted']
    assert state['tracked_conditions'] == {'runtime:known': ['old-pr'], 'runtime:fixed': ['new-pr']}


def test_completion_rejects_links_to_conditions_outside_batch(tmp_path):
    state = {}
    batch = bridge.reconcile(state, [], [{'request_id': '1', 'fingerprint': 'actual'}], 100, 'thread')
    batch['received'] = True
    result = tmp_path / 'result.json'
    result.write_text(json.dumps({'summary': 'candidate', 'evidence': [], 'unresolved': [],
        'next_action': 'review', 'condition_pull_requests': {'runtime:other': ['wrong-pr']}}))
    args = SimpleNamespace(command='complete', batch=batch['id'], revision=1, result=result)
    assert bridge.receipt(state, args, True)['reason'] == 'invalid_condition_pull_requests'
    assert not batch['completed'] and state['active_batch'] == batch['id']


@pytest.mark.parametrize('service,status,reason,replacement,expected_ok', [
    ('azure_openai', 'unavailable', 'Replaced by OpenRouter', 'healthy', True),
    ('azure_openai', 'unavailable', 'AZURE_OPENAI_API_KEY not set', 'healthy', False),
    ('azure_openai', 'unhealthy', 'Replaced by OpenRouter', 'healthy', False),
    ('azure_openai', 'unavailable', 'Replaced by OpenRouter', 'unhealthy', False),
    ('azure_openai', 'unavailable', 'Replaced by OpenRouter', None, False),
    ('supabase_db', 'unavailable', 'Replaced by OpenRouter', 'healthy', False),
])
def test_retired_azure_requires_explicit_retirement_and_healthy_replacement(
        monkeypatch, service, status, reason, replacement, expected_ok):
    services = {service: {'status': status, 'error': reason}}
    if replacement:
        services['openrouter'] = {'status': replacement}
    payload = json.dumps({'status': 'healthy', 'services': services}).encode()
    monkeypatch.setattr(monitor, 'urlopen', lambda *a, **kw: BytesIO(payload))
    checks = monitor.check_health({'base_url': 'https://www.makaron.app'})
    check = next(row for row in checks if row['name'] == 'health_' + service)
    assert check['ok'] == expected_ok
    batch = bridge.reconcile({}, checks, [], 100, 'thread')
    if expected_ok:
        assert check['status'] == 'unavailable'
        assert check['reason'] == 'retired_replaced_by_openrouter'
        assert batch is None
    else:
        assert 'health_' + service + ':' + status in batch['conditions']
    if replacement == 'unhealthy':
        assert 'health_openrouter:unhealthy' in batch['conditions']
