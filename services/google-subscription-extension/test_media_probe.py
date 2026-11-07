import struct
import unittest
from media_probe import probe_mp4


def box(kind, body, large=False):
    return (struct.pack('>I4sQ',1,kind,len(body)+16) if large else struct.pack('>I4s',len(body)+8,kind))+body


def movie(audio=False, version=0, large=False):
    header=(b'\x01\0\0\0'+bytes(16)+struct.pack('>IQ',1000,5184)) if version else bytes(12)+struct.pack('>II',1000,5184)
    def track(kind):return box(b'trak',box(b'mdia',box(b'hdlr',bytes(8)+kind)))
    return box(b'ftyp',b'isom')+box(b'moov',box(b'mvhd',header)+track(b'vide')+(track(b'soun') if audio else b''),large)+box(b'mdat',b'original bytes')


class ProbeTests(unittest.TestCase):
    def test_complete_movie_duration_and_audio(self):
        for version in [0,1]:
            for audio in [False,True]:
                for large in [False,True]:
                    with self.subTest(version=version,audio=audio,large=large):
                        data=movie(audio,version,large)
                        self.assertEqual(probe_mp4(data),{'duration_seconds':5.184,'has_audio':audio})
                        self.assertTrue(data.endswith(b'original bytes'))
    def test_unknown_duration_sentinel_is_not_a_real_duration(self):
        data=movie();start=data.index(b'mvhd')+20
        self.assertIsNone(probe_mp4(data[:start]+b'\xff'*4+data[start+4:]))
    def test_unknown_is_not_silent(self):
        for data in [b'',b'webm',movie()[:-1],box(b'moov',box(b'mvhd',bytes(20))),
                     box(b'moov',box(b'mvhd',bytes(20))+box(b'trak',box(b'mdia',b''))),
                     struct.pack('>I4s',1000000,b'moov')]:
            with self.subTest(data=data):self.assertIsNone(probe_mp4(data))
    def test_movie_after_media_and_parent_extending_atom(self):
        data=movie();a=data.index(b'moov')-4;b=data.index(b'mdat')-4
        reordered=data[:a]+data[b:]+data[a:b]
        self.assertEqual(probe_mp4(reordered)['duration_seconds'],5.184)
        self.assertEqual(probe_mp4(data[:b]+struct.pack('>I4s',0,b'mdat')+b'original bytes')['has_audio'],False)
    def test_missing_handler_is_unknown_even_with_a_valid_video_track(self):
        data=movie();i=data.index(b'mdat')-4
        broken=box(b'trak',box(b'mdia',b''));moov=data.index(b'moov')-4
        size=struct.unpack_from('>I',data,moov)[0]
        data=data[:moov]+struct.pack('>I',size+len(broken))+data[moov+4:i]+broken+data[i:]
        self.assertIsNone(probe_mp4(data))


if __name__=='__main__':unittest.main()
