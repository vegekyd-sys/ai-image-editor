"""Run against a separately supplied Scene relay checkout; never vendor OAuth."""
import os
import sys
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,os.environ['SCENE_GEMINI_APP'])
from server import Relay, handler
from makaron_relay import MakaronRelay, mount_handler
os.umask(0o077)
# Relay.__init__ reconciles RUNNING jobs. Never let a candidate touch the
# production journal, including through a symlink. Shared rollout mounts the
# extension in its reviewed entrypoint instead of using this candidate launcher.
if Path(os.environ['SCENE_GEMINI_STATE']).resolve() == Path('/srv/vlab/scene-gemini-relay/state').resolve():
    raise RuntimeError('Candidate entry refuses the production Scene state directory')
host=Relay()
extension=MakaronRelay(host,os.environ['MAKARON_GEMINI_CLOUD_URL'],os.environ['MAKARON_GEMINI_OWNER_ID'])
ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('SCENE_GEMINI_PORT','25987'))),
                    mount_handler(handler(host),host,extension)).serve_forever()
