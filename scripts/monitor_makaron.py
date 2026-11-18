#!/usr/bin/env python3
"""Read-only production detection. No generations, database writes or model calls."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_private(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    temporary.replace(path)


def normalized_path(value):
    path = urlsplit(value).path
    path = re.sub(r'[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}', ':id', path)
    # Avoid retaining user/project IDs or arbitrary uploaded file names.
    if not path.startswith('/api/'):
        return '/other'
    return re.sub(r'/[^/]{24,}', '/:id', path)[:180]


def error_signature(message):
    text = message.lower()
    for pattern, family in [
        (r'\[workspace\].*list error.*(?:statement.*timeout|57014)', 'workspace_list_timeout'),
        (r'\[dualwriter\].*message upsert error.*(?:statement.*timeout|57014)', 'message_write_timeout'),
        (r'\[gemini-2\.1\].*status:\s*402', 'image_provider_402'),
        (r'minimax.*invalid task_id', 'minimax_invalid_task_id'),
        (r'sigkill|exited with code 137|heap out of memory', 'process_killed'),
        (r'timed? ?out|deadline.exceeded', 'timeout'),
        (r'unhandled.*rejection|uncaught', 'unhandled_exception'),
    ]:
        if re.search(pattern, text, re.S):
            return family, family
    # Digest a normalized first line; never persist raw errors/prompts/URLs.
    text = text.splitlines()[0] if text else 'error_without_message'
    text = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}', '[private]', text)
    text = re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27,}|\b[a-z0-9_-]{20,}\b', '[id]', text)
    text = re.sub(r'"[^"]*"|\x27[^\x27]*\x27|\d+(?:\.\d+)?', '[value]', text)
    return 'runtime_error', hashlib.sha256(text.encode()).hexdigest()[:20]


def runtime_errors(raw, since, qualifying_stream=True):
    found = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        at = float(row['timestamp']) / 1000
        if at < since:
            continue
        # Vercel's --level error filters requests, but the representative message
        # and level can be info. Retain those requests, too; inspect by request ID.
        if not qualifying_stream and int(row.get('responseStatusCode', 0)) < 500 and row.get('level') not in {'error', 'fatal'}:
            continue
        path = normalized_path(row['requestPath'])
        family, digest = error_signature(str(row.get('message', '')))
        if int(row.get('responseStatusCode', 0)) >= 500:
            family = 'http_5xx'
            digest = str(row['responseStatusCode']) + ':' + digest
        rid = re.sub(r'[^a-zA-Z0-9_:.-]', '', str(row['id']))[:160]
        found[rid] = {'request_id': rid, 'at': at, 'http': int(row.get('responseStatusCode', 0)),
                      'path': path, 'family': family,
                      'fingerprint': hashlib.sha256((path + ':' + digest).encode()).hexdigest()[:24]}
    return list(found.values())


def request_errors(rows, since):
    """Fingerprint actual error logs, not the request's first performance line."""
    found = {}
    for row in rows:
        timestamp = row['timestamp']
        if isinstance(timestamp, str):
            at = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp() * 1000
        else:
            at = float(timestamp)
        logs = row.get('logs') or []
        if not isinstance(logs, list):
            raise ValueError('invalid_request_logs')
        messages = []
        error_logs = [l for l in logs if l.get('level') in {'error', 'fatal'}]
        for entry in error_logs:
            message = str(entry.get('message', ''))
            if message.startswith('[remotion-client-error] '):
                try:
                    diagnostic = json.loads(message[len('[remotion-client-error] '):])
                    if diagnostic.get('recovered') is True:
                        continue
                    message = 'remotion ' + str(diagnostic.get('phase')) + ' ' + str(diagnostic.get('kind')) + ': ' + str(diagnostic.get('message'))
                except (ValueError, TypeError, AttributeError):
                    pass
            messages.append(message)
        if not messages and (int(row['statusCode']) >= 500 or not error_logs):
            # A filtered request without available error detail stays visible.
            messages = ['request_error_detail_unavailable']
        for message in messages:
            flat = {'id': row['requestId'], 'timestamp': at, 'responseStatusCode': row['statusCode'],
                    'requestPath': row['requestPath'], 'message': message, 'level': 'error'}
            for error in runtime_errors(json.dumps(flat), since):
                found[(error['request_id'], error['fingerprint'])] = error
    return list(found.values())


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_log_page(config, start, end, selector, page):
    # Same read-only endpoint used by the installed Vercel CLI. Its CLI JSON
    # conversion discards all but logs[0], which can hide/collide real errors.
    owner = config.get('vercel_owner_id')
    if not owner:
        identity = json.loads((Path(config['handler_cwd']) / '.vercel/project.json').read_text())
        if identity['projectId'] != config['vercel_project_id']:
            raise RuntimeError('monitor_project_identity_mismatch')
        owner = identity['orgId']
    auth_paths = [Path.home() / 'Library/Application Support/com.vercel.cli/auth.json',
                  Path.home() / '.local/share/com.vercel.cli/auth.json',
                  Path.home() / '.config/vercel/auth.json']
    token = next((json.loads(p.read_text()).get('token') for p in auth_paths if p.exists()), None)
    if not token:
        raise RuntimeError('monitor_vercel_auth_unavailable')
    query = urlencode({'projectId': config['vercel_project_id'], 'ownerId': owner,
        'page': page, 'startDate': int(start * 1000), 'endDate': int(end * 1000),
        'environment': 'production', **selector})
    request = Request('https://vercel.com/api/logs/request-logs?' + query,
                      headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'MakaronProductionMonitor/2.0'})
    with build_opener(NoRedirect()).open(request, timeout=35) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise RuntimeError('monitor_log_payload_limit')
    data = json.loads(raw)
    if not isinstance(data.get('rows'), list) or not isinstance(data.get('hasMoreRows'), bool):
        raise ValueError('invalid_log_page_schema')
    return data


def read_runtime_logs(config, since, directory):
    until = time.time()
    errors, pages = {}, 0
    try:
        # Time bisection handles the service's observed 50-request response cap.
        # On any missing coverage, do not advance the successful watermark.
        for selector in [{'level': 'error'}, {'statusCode': '5xx'}]:
            pending = [(since, until, 0)]
            while pending:
                if pages >= 16:
                    raise RuntimeError('log_coverage_limit')
                start, end, page = pending.pop()
                result = fetch_log_page(config, start, end, selector, page)
                pages += 1
                rows = result['rows']
                for row in request_errors(rows, since):
                    errors[(row['request_id'], row['fingerprint'])] = row
                if result['hasMoreRows']:
                    pending.append((start, end, page + 1))
                elif len(rows) >= 50:
                    if end - start <= 1:
                        raise RuntimeError('log_coverage_limit')
                    mid = (start + end) / 2
                    pending.extend([(start, mid, 0), (mid, end, 0)])
        return {'name': 'runtime_logs', 'ok': True, 'pages': pages,
                'since': since, 'covered_until': until, 'observed_failures': len(errors)}, list(errors.values())
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        return {'name': 'runtime_logs', 'ok': False, 'error': code,
                'pages': pages, 'coverage': 'partial'}, list(errors.values())


def check_health(config):
    if config.get('base_url') != 'https://www.makaron.app':
        return [{'name': 'health', 'ok': False, 'error': 'invalid_monitor_origin'}]
    try:
        request = Request(config['base_url'] + '/api/health', headers={
            'Accept': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'MakaronProductionMonitor/1.0'})
        with urlopen(request, timeout=40) as response:
            data = json.loads(response.read(200_000))
        services = data['services']
        if not services or data['status'] not in {'healthy', 'degraded', 'down'}:
            raise ValueError('invalid_health_schema')
        checks = []
        for name, result in services.items():
            status = result['status']
            if status not in {'healthy', 'unhealthy', 'unavailable'}:
                raise ValueError('invalid_service_schema')
            retired_azure = (name == 'azure_openai' and status == 'unavailable'
                             and result.get('error') == 'Replaced by OpenRouter'
                             and services.get('openrouter', {}).get('status') == 'healthy')
            if retired_azure:
                checks.append({'name': 'health_' + name, 'ok': True,
                               'status': status, 'reason': 'retired_replaced_by_openrouter'})
                continue
            checks.append({'name': 'health_' + name, 'ok': status == 'healthy',
                           **({'error': status} if status != 'healthy' else {})})
        return checks
    except Exception as error:
        return [{'name': 'health', 'ok': False, 'error': type(error).__name__}]


def detect(config, state, directory):
    last = state.get('logs_covered_until', state.get('installed_at', time.time()) - 600)
    since = max(time.time() - 86400, last - 120)
    with ThreadPoolExecutor(max_workers=2) as pool:
        logs = pool.submit(read_runtime_logs, config, since, directory)
        checks = check_health(config)
        if any(not c['ok'] for c in checks):
            time.sleep(5)
            checks = check_health(config)
        log_check, errors = logs.result()
    if log_check['ok']:
        state['logs_covered_until'] = log_check['covered_until']
        state['log_read_failures'] = 0
    else:
        state['log_read_failures'] = state.get('log_read_failures', 0) + 1
        if state['log_read_failures'] < 3:
            log_check = {**log_check, 'ok': True, 'pending_confirmation': True}
    if time.time() - last > 86400:
        checks.append({'name': 'monitor_coverage', 'ok': False, 'error': 'gap_exceeds_24h'})
    return [*checks, log_check], errors
