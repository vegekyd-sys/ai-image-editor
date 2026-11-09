import asyncio
import json
import threading
import unittest
from unittest.mock import patch
from starlette.requests import Request
# Load deterministic env defaults used by the existing service tests.
import test_extension
import cloud


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_terminal_receipt_is_delivered_without_waiting_for_heartbeat(self):
        release=threading.Event()
        class Client:
            def close(self):pass
        def execute(body,value,client):
            try:
                if not release.wait(5):raise RuntimeError('test worker not released')
                value.update(state='SUCCEEDED',result={'analysis':'done'})
            finally:cloud.SLOTS.release()
        async def receive():return {'type':'http.request','body':json.dumps({'job_id':'test-id','request_sha256':'a'*64}).encode()}
        request=Request({'type':'http','method':'POST','path':'/makaron/generate','headers':[]},receive=receive)
        with patch.object(cloud,'validate'),patch.object(cloud,'storage',return_value=Client()),patch.object(cloud,'write',return_value=True),patch.object(cloud,'execute',side_effect=execute):
            response=await cloud.generate(request)
            iterator=response.body_iterator
            self.assertEqual(json.loads(await anext(iterator))['state'],'ACCEPTED')
            asyncio.get_running_loop().call_soon(release.set)
            self.assertEqual(json.loads(await anext(iterator))['state'],'SUCCEEDED')
            await iterator.aclose()


if __name__=='__main__':unittest.main()
