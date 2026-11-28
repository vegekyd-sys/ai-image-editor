"""Count terminal video export failures across distinct projects in event time."""
import json
from pathlib import Path
import subprocess
import uuid

WINDOW = 3600
OVERLAP = 120
THRESHOLD = 3


def observe(state, rows, until, thread_id):
    families = state.setdefault('export_failure_families', {})
    for row in sorted(rows, key=lambda r: (r['at'], r['id'])):
        at, family, project = row['at'], row['family'], row['project_id']
        group = families.get(family)
        if group is None or at - group['last'] > WINDOW:
            group = families[family] = {'last': at, 'projects': {}}
        latest = max(at, group['last'])
        if latest - at > WINDOW:
            continue
        projects = {p: stamp for p, stamp in group['projects'].items() if latest - stamp <= WINDOW}
        projects[project] = max(at, projects.get(project, at))
        group.update(last=latest, projects=projects)
        if len(projects) >= THRESHOLD and 'alert' not in group:
            bid = str(uuid.uuid4())
            group['alert'] = bid
            state.setdefault('export_alert_batches', []).append(bid)
            evidence = {'family': family, 'projects': sorted(projects), 'threshold_job': row['id'],
                        'at': at, 'window_seconds': WINDOW}
            state.setdefault('batches', {})[bid] = {
                'id': bid, 'thread_id': thread_id, 'created_at': until, 'revision': 1,
                'phase': 'pending', 'received': False, 'completed': False, 'export_alert': evidence,
                'conditions': ['export_failures:' + family], 'observations': []}
    state['export_failure_families'] = {k: g for k, g in families.items() if until - g['last'] <= WINDOW}
    state['export_checked_until'] = until


def poll(config, state, now):
    cursor = state.get('export_checked_until', now - WINDOW)
    until = min(now, cursor + WINDOW)
    try:
        data = subprocess.check_output(['/opt/homebrew/bin/node', str(Path(__file__).with_name('export-watch.mjs')),
                                        config['handler_cwd'], str(cursor - OVERLAP), str(until)],
                                       timeout=22, stderr=subprocess.DEVNULL)
        rows = json.loads(data)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        # Preserve the first failed interval even when the initial query is unavailable.
        state.setdefault('export_checked_until', cursor)
        return {'name': 'export_jobs', 'ok': False, 'error': type(exc).__name__}
    observe(state, rows, until, config['thread_id'])
    return {'name': 'export_jobs', 'ok': True, 'covered_until': until}
