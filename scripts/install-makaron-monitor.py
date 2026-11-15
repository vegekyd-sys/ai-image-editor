#!/usr/bin/env python3
"""Install the local event detector paused; enable after checking its baseline."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import time

from monitor_makaron import write_private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--thread', required=True)
    parser.add_argument('--cwd', type=Path, required=True, help='Stable canonical checkout, not a disposable worktree')
    parser.add_argument('--codex', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    cwd = args.cwd.resolve()
    project = json.loads((cwd / '.vercel/project.json').read_text())
    if project.get('projectName') != 'ai-image-editor' or not args.codex.is_file():
        raise SystemExit('Expected the linked Makaron project and an existing Codex CLI')
    vercel = shutil.which('vercel')
    if not vercel:
        raise SystemExit('Existing Vercel CLI login required')
    directory = Path.home() / '.codex/monitors/makaron-production'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    config_path = directory / 'bridge-config.json'
    if config_path.exists() and json.loads(config_path.read_text())['thread_id'] != args.thread:
        raise SystemExit('Existing monitor belongs to another chat; do not replace it')
    state_path = directory / 'bridge-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'installed_at': time.time()}
    if state.get('active_batch') or state.get('selftest_batch'):
        raise SystemExit('Finish the active batch before reinstalling')
    state['enabled'] = False
    write_private(state_path, state)
    source = Path(__file__).resolve().parent
    for name in ['monitor_makaron.py', 'makaron_event_bridge.py', 'makaron_event_worker.py', 'makaron_desktop_ipc.py']:
        shutil.copyfile(source / name, directory / name)
        (directory / name).chmod(0o700)
    shutil.copyfile(source.parent / 'docs/ops/makaron-incident-instructions.md', directory / 'incident-instructions.md')
    shutil.copyfile(source.parent / 'docs/ops/makaron-production-selfcheck.md', directory / 'README.md')
    write_private(config_path, {'base_url': 'https://www.makaron.app',
        'vercel_project_id': project['projectId'], 'vercel_cli': vercel,
        'vercel_owner_id': project['orgId'],
        'codex_cli': str(args.codex.resolve()), 'thread_id': args.thread, 'handler_cwd': str(cwd)})
    label = 'com.tianyi.makaron-monitor-event-bridge'
    plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
    with plist.open('wb') as handle:
        plistlib.dump({'Label': label, 'ProgramArguments': ['/usr/bin/python3', str(directory / 'makaron_event_bridge.py'),
            '--directory', str(directory), 'tick'], 'WorkingDirectory': str(directory),
            'EnvironmentVariables': {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin'},
            'RunAtLoad': True, 'StartInterval': 120, 'ProcessType': 'Background',
            'StandardOutPath': str(directory / 'bridge.log'), 'StandardErrorPath': str(directory / 'bridge.err.log')}, handle)
    domain = 'gui/' + str(os.getuid())
    subprocess.run(['launchctl', 'bootout', domain + '/' + label], capture_output=True)
    subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True, capture_output=True)
    print(json.dumps({'installed': str(directory), 'enabled': False, 'interval_seconds': 120}))


if __name__ == '__main__':
    main()
