#!/usr/bin/env python3
"""Launchd-owned, one-incident Codex execution; no queue, polling model or daemon."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time

from monitor_makaron import utc_now, write_private
from makaron_event_bridge import handler_message
from makaron_desktop_ipc import DesktopIPC


@contextmanager
def state_lock(directory):
    with (directory / 'bridge.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def edit_batch(directory, bid, token, change, when=None):
    with state_lock(directory):
        path = directory / 'bridge-state.json'
        state = json.loads(path.read_text())
        batch = state.get('batches', {}).get(bid)
        if not batch or batch.get('dispatch_id') != token or (when and not when(state, batch)):
            return None
        change(state, batch)
        write_private(path, state)
        return batch


def executable_batch(state, batch):
    return (state.get('enabled', False) and not batch.get('completed')
            and not batch.get('received')
            and batch['id'] in {state.get('active_batch'), state.get('selftest_batch')})


def command(config, directory):
    # Preserve the existing account/model/permission configuration. No new global
    # daemon, model override, thread, worktree or credential is created here.
    return [config['codex_cli'], '--no-daemon', 'exec',
            '--cd', config['handler_cwd'], '--add-dir', str(directory), '--json',
            'resume', config['thread_id'], '-']


def desktop_dispatch(config, message, token, facts, cancelled=None, notify=lambda *_: None, enabled=lambda: True, idle_timeout=600):
    path = Path(config.get('desktop_ipc_socket', str(Path.home() / '.codex/ipc/ipc.sock')))
    if not path.exists():
        return False
    try:
        client = DesktopIPC(path)
    except (ConnectionRefusedError, FileNotFoundError) as error:
        # Only the connection/initialization has been attempted, never turn/start.
        facts['desktop_unavailable'] = type(error).__name__
        return False
    try:
        owner = client.owner(config['thread_id'])
        if owner is None:
            return False
        facts.update(transport='desktop_owner_native_turn', owner_client_id=owner,
                     thread_id=config['thread_id'], thread_matched=True,
                     owner_idle_wait_started_at=utc_now())
        notify('waiting_for_chat_idle', facts)
        started = time.monotonic()
        client.wait_idle(config['thread_id'], owner, idle_timeout, cancelled or threading.Event(), enabled)
        facts.update(owner_idle_observed_at=utc_now(), owner_idle_wait_seconds=round(time.monotonic()-started, 3),
                     setup_turn_id=client.initial_turn_id, native_submission_attempted_at=utc_now())
        notify('executing', facts)
        try:
            reply = client.start_turn(config['thread_id'], owner, message, token)
        except Exception as error:
            # The request might already be accepted. Never also invoke a CLI or
            # resubmit on an ambiguous transport failure; wait for the receipt.
            facts['native_submission_unconfirmed'] = type(error).__name__
            return True
        facts['native_accepted'] = reply.get('resultType') == 'success'
        if not facts['native_accepted']:
            facts['native_rejected'] = True
            # These exact IPC replies occur before the start-turn handler runs.
            # A disconnect, timeout or application error may follow delivery.
            if reply.get('resultType') == 'error' and reply.get('error') in (
                    'no-client-found', 'request-version-mismatch', 'no-handler-for-request'):
                facts['native_not_delivered'] = True
            facts['native_error'] = str(reply.get('error', 'request_failed'))[:160]
        result = reply.get('result', {})
        for _ in range(4):
            if not isinstance(result, dict):
                break
            if isinstance(result.get('turn'), dict):
                facts['native_turn_id'] = result['turn'].get('id')
                break
            result = result.get('result')
        return True
    finally:
        client.close()


def observe_events(stream, expected_thread, facts, mismatch):
    """Only event metadata is retained, never prompts, tool output or secrets."""
    while True:
        line = stream.readline(1_000_001)
        if not line:
            return
        if len(line) > 1_000_000:
            while line and not line.endswith(b'\n'):
                line = stream.readline(1_000_001)
            continue
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        kind = event.get('type')
        if kind == 'thread.started':
            actual = event.get('thread_id')
            facts['thread_id'] = actual
            facts['thread_matched'] = actual == expected_thread
            if actual != expected_thread:
                mismatch.set()
        elif kind == 'turn.started':
            facts['turn_started_at'] = utc_now()
        elif kind == 'turn.completed':
            facts['turn_completed_at'] = utc_now()
            facts['usage'] = {k: v for k, v in event.get('usage', {}).items()
                              if isinstance(v, (int, float))}
        elif kind in {'turn.failed', 'error'}:
            facts['error_event'] = True
        elif kind == 'item.completed' and event.get('item', {}).get('type') == 'agent_message':
            text = str(event['item'].get('text', ''))
            facts['assistant_message_bytes'] = len(text.encode())
            facts['assistant_message_sha256'] = hashlib.sha256(text.encode()).hexdigest()


def drain_stderr(stream, facts):
    pending = b''
    while True:
        chunk = stream.read(4096)
        if not chunk:
            chunk = b'\n' if pending else b''
            if not chunk:
                return
        facts['stderr_bytes'] = facts.get('stderr_bytes', 0) + len(chunk)
        # Store only known failure classes, not potentially sensitive stderr.
        for marker, label in [(b'Unauthorized', 'authentication'),
                              (b'failed to connect', 'connection'),
                              (b'context window', 'context_limit')]:
            if marker.lower() in chunk.lower():
                facts[label + '_error'] = True
        pending += chunk
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            text = line.decode(errors='replace').strip()
            if (any(word in text.lower() for word in ['error:', 'failed', 'caused by:', 'not found'])
                    and not any(word in text.lower() for word in
                                ['bearer', 'authorization', 'password', 'secret', 'api_key', 'api-key', 'api key', 'credential', 'keychain', 'token'])):
                text = re.sub(r'(?:https?|postgres(?:ql)?)://\S+', '[URL]', text)
                text = re.sub(r'[A-Za-z0-9_-]{40,}', '[REDACTED]', text)
                facts['startup_diagnostics'] = (facts.get('startup_diagnostics', []) + [text[:400]])[-4:]
        pending = pending[-4096:]


def stop_process(process):
    # CLI and its descendants inherit this launchd job's process group. launchd
    # also reaps that group when this one-shot job exits; no detached CLI orphan.
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def run(directory, bid, token):
    os.umask(0o077)
    config = json.loads((directory / 'bridge-config.json').read_text())
    facts = {'worker_pid': os.getpid(), 'started_at': utc_now(),
             'dispatch_id': token, 'transport': 'launchd_exec_resume_no_daemon'}
    cancelled = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: cancelled.set())
    signal.signal(signal.SIGINT, lambda *_: cancelled.set())
    def unstarted(state, batch):
        return executable_batch(state, batch) and not batch.get('worker', {}).get('started_at')

    # Reserve this dispatch *before* contending with unrelated jobs for the slot.
    batch = edit_batch(directory, bid, token, lambda _, b: b.update(
        phase='waiting_for_slot', phase_started_at=time.time(), worker=dict(facts)), when=unstarted)
    if not batch:
        return 0

    def may_submit():
        with state_lock(directory):
            state = json.loads((directory / 'bridge-state.json').read_text())
            current = state.get('batches', {}).get(bid)
            return (current and current.get('dispatch_id') == token and not cancelled.is_set()
                    and executable_batch(state, current))

    def progress(phase, metadata):
        def change(_, current):
            current.update(phase=phase, phase_started_at=time.time(), worker=dict(metadata))
            if phase == 'executing':
                current['model_requested_at'] = time.time()
        if not edit_batch(directory, bid, token, change,
                          when=lambda st, b: not cancelled.is_set() and executable_batch(st, b)):
            raise RuntimeError('dispatch_no_longer_executable')

    with (directory / 'handler.lock').open('a') as gate:
        wait_until = time.monotonic() + 180
        while True:
            try:
                fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not may_submit() and not cancelled.is_set():
                    return 0
                if time.monotonic() >= wait_until or cancelled.wait(0.5):
                    reason = 'cancelled' if cancelled.is_set() else 'handler_slot_timeout'
                    failed = edit_batch(directory, bid, token, lambda _, b: b.update(
                        phase='dispatch_failed', worker={**facts, 'finished_at': utc_now(), 'error': reason}),
                        when=executable_batch)
                    return 2 if failed else 0
        message = handler_message(batch, directory)
        process = None
        exit_code = None
        handed_off = False
        try:
            if desktop_dispatch(config, message, token, facts, cancelled, progress, may_submit,
                                600 if batch.get('selftest') else 3600):
                handed_off = not facts.get('native_rejected')
                # The desktop owner controls this turn. A receipt observer does
                # not own its execution slot and cannot terminate or replay it.
                fcntl.flock(gate, fcntl.LOCK_UN)
                if not handed_off:
                    return 2
                if not batch.get('selftest'):
                    exit_code = 0
                    return 0
                edit_batch(directory, bid, token, lambda _, b: b.update(worker=dict(facts)))
                deadline = time.monotonic() + 600
                while True:
                    with state_lock(directory):
                        state = json.loads((directory / 'bridge-state.json').read_text())
                        observed = state['batches'][bid]
                    if observed.get('dispatch_id') != token:
                        return 0
                    if observed.get('completed'):
                        facts['receipt_completed_at'] = observed['completed_at']
                        exit_code = 0
                        return 0
                    if not state.get('enabled') or cancelled.is_set() or time.monotonic() >= deadline:
                        facts['stopped_reason'] = 'disabled_cancelled_or_receipt_deadline'
                        return 2
                    time.sleep(0.5)
            progress('executing', facts)
            try:
                process = subprocess.Popen(command(config, directory), stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           cwd=config['handler_cwd'])
            except OSError:
                # Popen failed before a child could receive the prompt on stdin.
                facts['cli_not_started'] = True
                raise
            facts['cli_pid'] = process.pid
            edit_batch(directory, bid, token, lambda _, b: b.update(worker=dict(facts)))
            readers = [threading.Thread(target=observe_events,
                         args=(process.stdout, config['thread_id'], facts, cancelled), daemon=True),
                       threading.Thread(target=drain_stderr, args=(process.stderr, facts), daemon=True)]
            for reader in readers:
                reader.start()
            process.stdin.write(message.encode())
            process.stdin.close()
            deadline = time.monotonic() + (600 if batch.get('selftest') else 3600)
            while process.poll() is None:
                with state_lock(directory):
                    state = json.loads((directory / 'bridge-state.json').read_text())
                    enabled = state.get('enabled') and state['batches'][bid].get('dispatch_id') == token
                if cancelled.is_set() or not enabled or time.monotonic() >= deadline:
                    facts['stopped_reason'] = ('disabled' if not enabled else
                                              'cancelled_or_thread_mismatch' if cancelled.is_set()
                                              else 'execution_deadline')
                    stop_process(process)
                    break
                time.sleep(0.5)
            exit_code = process.wait()
            for reader in readers:
                reader.join(timeout=3)
            writer_error = (f"Error: thread/resume: thread/resume failed: thread {config['thread_id']} "
                            "already has an active writer (code -32600)")
            if (exit_code == 1 and not any(reader.is_alive() for reader in readers)
                    and not any(key in facts for key in ('thread_id', 'turn_started_at', 'turn_completed_at',
                                                        'assistant_message_bytes', 'stopped_reason'))
                    and facts.get('startup_diagnostics', [])[-1:] == [writer_error]):
                facts['cli_resume_rejected'] = True
        except Exception as error:
            facts['launch_error_type'] = type(error).__name__
        finally:
            if process is not None:
                stop_process(process)
            facts['finished_at'] = utc_now()
            if process is not None:
                facts['cli_exit_code'] = exit_code
            def finish(_, batch):
                batch['worker'] = dict(facts)
                not_delivered = any(facts.get(key) for key in
                                    ('cli_not_started', 'native_not_delivered', 'cli_resume_rejected'))
                if not_delivered and not batch.get('received') and not batch.get('completed'):
                    batch.pop('model_requested_at', None)
                if not handed_off and not batch.get('completed') and (process is not None or not batch.get('received')):
                    batch.update(phase='handler_failed', handler_error='exec_did_not_complete_receipt')
                if batch.get('selftest'):
                    passed = bool(batch.get('received') and batch.get('completed')
                                  and facts.get('thread_matched') and exit_code == 0
                                  and (facts.get('turn_completed_at') or
                                       (facts.get('native_accepted') and facts.get('receipt_completed_at')
                                        and facts.get('native_turn_id')
                                        and facts.get('native_turn_id') != facts.get('setup_turn_id')
                                        and facts.get('owner_idle_observed_at'))))
                    acceptance = {'batch': bid, 'passed': passed,
                        'transport': facts['transport'], 'thread_id': config['thread_id'],
                        'dispatched_at': batch['dispatched_at'],
                        'first_receipt_at': batch.get('first_receipt_at'),
                        'completed_at': batch.get('completed_at'), 'worker': dict(facts),
                        'dispatch_to_claim_seconds': (round(batch['first_receipt_at'] - batch['dispatched_at'], 3)
                            if batch.get('first_receipt_at') else None),
                        'makaron_probes_by_selftest': 0,
                        'scope': 'actual independent Codex execution in original thread; no business calls'}
                    write_private(directory / ('wake-acceptance-' + bid + '.json'), acceptance)
            edit_batch(directory, bid, token, finish)
    return 0 if exit_code == 0 else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--batch', required=True)
    parser.add_argument('--dispatch-id', required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.directory.resolve(), args.batch, args.dispatch_id))
