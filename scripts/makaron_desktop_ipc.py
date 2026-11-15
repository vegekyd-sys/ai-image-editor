"""Minimal client for the installed desktop's owner/follower IPC protocol.

The versioned protocol is read from the installed desktop implementation, not
an attempt to acquire or alter the thread-store writer lease.
"""
import json
import os
from pathlib import Path
import socket
import select
import stat
import struct
import time
import uuid


class DesktopIPCError(RuntimeError):
    pass


class DesktopIPC:
    def __init__(self, path):
        path = Path(path)
        info = path.stat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            raise DesktopIPCError('socket_not_owned_by_current_user')
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(12)
        self.socket.connect(str(path))
        self.buffer = bytearray()
        self.following = None
        self.runtime_status = None
        self.initial_turn_id = None
        self.client_id = 'initializing-client'
        result = self.request('initialize', {'clientType': 'makaron-monitor'}, 0)
        if result.get('resultType') != 'success':
            self.close()
            raise DesktopIPCError('initialize_failed')
        self.client_id = result['result']['clientId']

    def close(self):
        self.socket.close()

    def send(self, payload):
        raw = json.dumps(payload).encode()
        self.socket.sendall(struct.pack('<I', len(raw)) + raw)

    def read_exactly(self, size):
        raw = b''
        while len(raw) < size:
            data = self.socket.recv(size - len(raw))
            if not data:
                raise DesktopIPCError('connection_closed')
            raw += data
        return raw

    def next_frame(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            if len(self.buffer) >= 4:
                size = struct.unpack('<I', self.buffer[:4])[0]
                if size > 8_000_000:
                    raise DesktopIPCError('frame_too_large')
                if len(self.buffer) >= size + 4:
                    frame = json.loads(self.buffer[4:size + 4])
                    del self.buffer[:size + 4]
                    self.observe_status(frame)
                    return frame
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.socket], [], [], remaining)[0]:
                raise TimeoutError('ipc_frame_deadline')
            part = self.socket.recv(65536)
            if not part:
                raise DesktopIPCError('connection_closed')
            self.buffer.extend(part)

    def observe_status(self, frame):
        params = frame.get('params', {})
        if frame.get('method') != 'thread-stream-state-changed' or params.get('conversationId') != self.following:
            return
        change = params.get('change', {})
        if change.get('type') == 'snapshot':
            state = change.get('conversationState', {})
            self.runtime_status = state.get('threadRuntimeStatus', {}).get('type')
            turns = state.get('turns', [])
            if turns and self.initial_turn_id is None:
                active = next((t for t in reversed(turns) if t.get('status') == 'inProgress' and t.get('turnId')), None)
                self.initial_turn_id = (active or turns[-1]).get('turnId')
        elif change.get('type') == 'patches':
            for patch in change.get('patches', []):
                path = patch.get('path', [])
                if path == ['threadRuntimeStatus']:
                    self.runtime_status = (patch.get('value') or {}).get('type')
                elif path == ['threadRuntimeStatus', 'type']:
                    self.runtime_status = patch.get('value')

    def follow(self, thread_id, owner, following):
        self.following = thread_id if following else None
        self.send({'type': 'broadcast', 'method': 'thread-stream-following-changed',
                   'sourceClientId': self.client_id, 'targetClientIds': [owner], 'version': 1,
                   'params': {'conversationId': thread_id, 'hostId': 'local', 'following': following}})

    def wait_idle(self, thread_id, owner, timeout, cancelled, enabled=lambda: True):
        self.follow(thread_id, owner, True)
        deadline = time.monotonic() + timeout
        try:
            while time.monotonic() < deadline and not cancelled.is_set() and enabled():
                if self.runtime_status == 'idle':
                    return
                try:
                    frame = self.next_frame(min(1, max(0, deadline - time.monotonic())))
                except TimeoutError:
                    continue
                if frame.get('type') == 'client-discovery-request':
                    self.send({'type': 'client-discovery-response', 'requestId': frame['requestId'],
                               'response': {'canHandle': False}})
            raise DesktopIPCError('owner_still_busy_or_cancelled')
        finally:
            self.follow(thread_id, owner, False)

    def request(self, method, params, version, target=None, request_id=None, timeout=12):
        rid = request_id or str(uuid.uuid4())
        data = {'type': 'request', 'requestId': rid, 'sourceClientId': self.client_id,
                'version': version, 'method': method, 'params': params, 'timeoutMs': int((timeout-2)*1000)}
        if target:
            data['targetClientId'] = target
        self.send(data)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            reply = self.next_frame(max(0, deadline - time.monotonic()))
            if reply.get('type') == 'response' and reply.get('requestId') == rid:
                return reply
            if reply.get('type') == 'client-discovery-request':
                # This process never handles requests for other chats.
                self.send({'type': 'client-discovery-response', 'requestId': reply['requestId'],
                           'response': {'canHandle': False}})
        raise DesktopIPCError('request_deadline')

    def owner(self, thread_id):
        reply = self.request('thread-owner-discovery',
                             {'hostId': 'local', 'conversationId': thread_id}, 1)
        if reply.get('resultType') == 'success':
            return reply['handledByClientId']
        if reply.get('error') == 'no-client-found':
            return None
        raise DesktopIPCError('owner_discovery_failed')

    def start_turn(self, thread_id, owner, message, dispatch_id):
        # Use the supported standard turn/start path after an idle observation;
        # never steer/interrupt an active user turn or use a newer extension.
        return self.request('thread-follower-start-turn', {
            'conversationId': thread_id,
            'turnStart': {
                'request': {'threadId': thread_id, 'clientUserMessageId': dispatch_id,
                            'input': [{'type': 'text', 'text': message, 'text_elements': []}]},
                'context': {'inheritThreadSettings': True, 'useUserMessageAdmission': False},
            }}, 2, owner, dispatch_id, timeout=65)
