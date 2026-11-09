"""Bounded ISO BMFF header inspection. Unknown containers fall back to ffprobe.

No decoding, frame sampling or media rewriting. An absent audio track is claimed
only after validating the complete movie and every track's handler atom.
"""
import math
import struct


def probe_mp4(data):
    def boxes(start, end):
        offset = start
        result = []
        while offset < end:
            if offset + 8 > end:
                raise ValueError('truncated box')
            size, kind = struct.unpack_from('>I4s', data, offset)
            header = 8
            if size == 1:
                if offset + 16 > end:
                    raise ValueError('truncated large box')
                size = struct.unpack_from('>Q', data, offset + 8)[0]
                header = 16
            elif size == 0:
                size = end - offset
            if size < header or offset + size > end:
                raise ValueError('invalid box')
            result.append((kind, offset + header, offset + size))
            offset += size
        return result

    def only(children, kind):
        selected = [box for box in children if box[0] == kind]
        if len(selected) != 1:
            raise ValueError('missing or ambiguous atom')
        return selected[0]

    try:
        _, start, end = only(boxes(0, len(data)), b'moov')
        movie = boxes(start, end)
        _, body, stop = only(movie, b'mvhd')
        version = data[body]
        if version not in {0, 1}:
            return None
        scale_offset = body + (20 if version else 12)
        duration_offset = scale_offset + 4
        duration_size = 8 if version else 4
        if duration_offset + duration_size > stop:
            return None
        scale = struct.unpack_from('>I', data, scale_offset)[0]
        ticks = struct.unpack_from('>Q' if version else '>I', data, duration_offset)[0]
        if ticks == (1 << (duration_size*8))-1:
            return None  # ISO BMFF unknown duration sentinel
        duration = ticks / scale
        if not math.isfinite(duration) or duration <= 0:
            return None
        handlers = []
        for kind, start, stop in movie:
            if kind != b'trak':
                continue
            _, left, right = only(boxes(start, stop), b'mdia')
            _, body, stop = only(boxes(left, right), b'hdlr')
            if body + 12 > stop:
                return None
            handlers.append(data[body + 8:body + 12])
        if b'vide' not in handlers:
            return None
        return {'duration_seconds': duration, 'has_audio': b'soun' in handlers}
    except (ValueError, IndexError, ZeroDivisionError, struct.error, OverflowError):
        return None
