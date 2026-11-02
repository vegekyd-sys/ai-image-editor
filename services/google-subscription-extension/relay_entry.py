"""Run against a separately supplied Scene relay checkout; never vendor OAuth."""
import os
import sys
from http.server import ThreadingHTTPServer
sys.path.insert(0,os.environ['SCENE_GEMINI_APP'])
from server import Relay, handler
from makaron_relay import MakaronRelay, mount_handler
os.umask(0o077)
host=Relay()
extension=MakaronRelay(host,os.environ['MAKARON_GEMINI_CLOUD_URL'],os.environ['MAKARON_GEMINI_OWNER_ID'])
ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('SCENE_GEMINI_PORT','25987'))),
                    mount_handler(handler(host),host,extension)).serve_forever()
