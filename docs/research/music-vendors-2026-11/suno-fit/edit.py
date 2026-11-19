"""Fit a Suno take to an exact target length.

fade   : keep [0, T], equal-power fade over the last F seconds.
splice : keep the take's own ending; cut the body on a beat that is phrase-aligned
         (beat-index distance multiple of 16/8/4) with the start of the ending,
         crossfade 120 ms, then land exactly on T.
Usage: python edit.py <in.mp3> <target_seconds> <out_prefix>
Prints JSON with what was done.
"""
import json, subprocess, sys
import wave
import numpy as np

SR = 44100


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def encode(y, path):
    wav = path.replace('.mp3', '.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-b:a', '192k', path], check=True)
    subprocess.run(['rm', wav])


HOP, NFFT = 512, 2048


def stft_mag(mono):
    n = 1 + (len(mono) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(mono[idx] * np.hanning(NFFT), axis=1)).T  # (bins, frames)


def band_feat(mag, nb=24):
    edges = np.unique(np.geomspace(2, mag.shape[0] - 1, nb + 1).astype(int))
    bands = np.vstack([mag[a:b].mean(axis=0) for a, b in zip(edges[:-1], edges[1:])])
    return np.log1p(bands * 10)


def beat_grid(mono, bpm_hint):
    mag = stft_mag(mono)
    logm = np.log1p(mag)
    flux = np.maximum(0, np.diff(logm, axis=1)).sum(axis=0)
    flux = np.concatenate([[0], flux]); flux -= flux.mean(); flux = np.maximum(flux, 0)
    fps = SR / HOP
    ac = np.correlate(flux, flux, 'full')[len(flux) - 1:]
    def lag(bpm): return fps * 60 / bpm
    cands = np.arange(60, 181, 0.5)
    w = np.exp(-0.5 * (np.log2(cands / bpm_hint) / 0.08) ** 2) if bpm_hint else np.ones_like(cands)
    score = np.array([ac[int(round(lag(b)))] for b in cands]) * (0.3 + w)
    coarse = float(cands[score.argmax()])
    sm = np.convolve(flux, np.hanning(5) / np.hanning(5).sum(), 'same')
    x = np.arange(len(sm))

    def grid_score(bpm):
        period = lag(bpm)
        best = (-1, 0)
        for o in np.arange(0, period, 0.5):
            pos = np.arange(o, len(sm) - 1, period)
            v = np.interp(pos, x, sm).sum() / len(pos)
            if v > best[0]:
                best = (v, o)
        return best

    fine = np.arange(coarse - 1.5, coarse + 1.5, 0.02)
    scored = [(grid_score(b), b) for b in fine]
    (gs, phase), bpm = max(scored, key=lambda s: s[0][0])
    period = lag(bpm)
    grid = np.arange(phase, len(sm) - 1, period)
    snapped = []
    for g in grid:  # snap each grid beat to the local onset peak (+-35 ms)
        a, b = int(max(0, g - 3)), int(min(len(sm) - 1, g + 3))
        snapped.append(a + np.argmax(sm[a:b + 1]) if sm[a:b + 1].max() > sm.mean() * 1.5 else g)
    beats = np.array(snapped) / fps
    return float(bpm), beats, band_feat(mag), mag


def natural_end(y):
    mono = y.mean(axis=1)
    hop = 2205
    n = len(mono) // hop
    rms = np.sqrt((mono[:n * hop].reshape(n, hop) ** 2).mean(axis=1))
    thr = rms.max() * 10 ** (-48 / 20)
    idx = np.where(rms > thr)[0]
    return min(len(mono), (idx[-1] + 2) * hop) / SR


def fit_exact(y, T, tail_fade=0.6):
    n = int(round(T * SR))
    if len(y) >= n:
        y = y[:n].copy()
        f = int(tail_fade * SR)
        y[-f:] *= np.cos(np.linspace(0, np.pi / 2, f))[:, None]
        return y
    return np.vstack([y, np.zeros((n - len(y), 2), dtype=y.dtype)])


def fade(y, T):
    F = 3.0 if T <= 40 else 4.0
    n = int(round(T * SR))
    out = y[:n].copy()
    f = int(F * SR)
    out[-f:] *= np.cos(np.linspace(0, np.pi / 2, f))[:, None]
    return out, {'fade_seconds': F}


def splice(y, T, end_t, bpm_hint=None):
    mono = y.mean(axis=1)
    tempo, beats, feat, _ = beat_grid(mono, bpm_hint)
    beat_len = 60.0 / tempo
    beats = beats[beats < end_t]

    def window(t):
        a = int(t * SR / HOP)
        b = int((t + beat_len * 2) * SR / HOP)
        return feat[:, a:max(b, a + 1)].mean(axis=1)

    ending_len_target = min(10.0, max(5.0, 0.3 * T))
    e_cands = [i for i, t in enumerate(beats) if end_t - 14 <= t <= end_t - 4]
    best = None
    for mod in (16, 8, 4):
        for ie in e_cands:
            tail = end_t - beats[ie]
            for ib in range(len(beats)):
                if ib >= ie or (ie - ib) % mod:
                    continue
                total = beats[ib] + tail
                err = abs(total - T)
                if err > beat_len * 2.01 or beats[ib] < T * 0.4:
                    continue
                a, b = window(beats[ib]), window(beats[ie])
                sim = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
                score = sim - 0.15 * err / beat_len - 0.02 * abs(tail - ending_len_target)
                if best is None or score > best[0]:
                    best = (score, ib, ie, sim, err, mod)
        if best:
            break
    if not best:
        return None, {'reason': 'no aligned splice point'}
    _, ib, ie, sim, err, mod = best
    tb, te = beats[ib], beats[ie]
    xf, pre = int(0.06 * SR), int(0.015 * SR)
    cb, ce = int(tb * SR) - pre, int(te * SR) - pre  # crossfade ends 15 ms before the beat
    head = y[:cb].copy()
    tail = y[ce - xf:int(end_t * SR)].copy()
    ramp = np.sin(np.linspace(0, np.pi / 2, xf))[:, None]
    head[-xf:] = head[-xf:] * ramp[::-1] + tail[:xf] * ramp
    out = np.vstack([head, tail[xf:]])
    raw_len = len(out) / SR
    out = fit_exact(out, T, tail_fade=0.8)
    return out, {'tempo': round(tempo, 1), 'cut_at': round(tb, 2), 'ending_from': round(te, 2),
                 'beats_removed': ie - ib, 'phrase_mod': mod, 'similarity': round(sim, 3),
                 'pre_fit_len': round(raw_len, 2)}


def main():
    src, T, prefix = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    bpm_hint = float(sys.argv[4]) if len(sys.argv) > 4 else None
    y = decode(src)
    end_t = natural_end(y)
    info = {'src': src, 'target': T, 'raw_len': round(len(y) / SR, 2), 'natural_end': round(end_t, 2)}
    if end_t <= T + 0.5:
        encode(fit_exact(y[:int(end_t * SR)], T), f'{prefix}_exact.mp3')
        info['exact'] = 'already within target'
    else:
        out, meta = fade(y, T)
        encode(out, f'{prefix}_fade.mp3')
        info['fade'] = meta
        out, meta = splice(y, T, end_t, bpm_hint)
        if out is not None:
            encode(out, f'{prefix}_splice.mp3')
        info['splice'] = meta
    print(json.dumps(info))


if __name__ == '__main__':
    main()
