"""Experiments 2 & 3 (linear / gain-clamped regime): packing density, encodings, cross-talk and lifetime frontier.

For a LINEAR operator (passive optics + global gain clamp) multi-dot evolution is exactly M^t x0, so every lattice,
encoding and bit pattern is evaluated from the explicit matrix (validated against direct JS evolution to 1e-11 at
1e5 trips, out/04/validate_A_img.json). Horizons are powers of two: x_{2^k} = M^{2^(k-1)} x_{2^(k-1)}.

usage: python 02-linear-packing.py <operator> [maxlog2]
"""
import json, os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module
cp = import_module('04-coupling')

OUT = os.path.join(os.path.dirname(__file__), 'out', '02')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(12345)
NPAT = 24
FOV_HALF = float(os.environ.get('FOV_HALF', 400e-6))


def lattice(n, dx, pitch_s, margin_s, odd=False):
    half = (n / 2 - margin_s) * dx
    k = int(np.floor(2 * half / (pitch_s * dx) + 1e-9)) + 1
    if odd and k % 2 == 0:
        k -= 1
    c = (np.arange(k) - (k - 1) / 2) * pitch_s * dx
    return np.array([(x, y) for y in c for x in c]), k


def basis(n, dx, centers, sigma):
    x = (np.arange(n) - n / 2 + 0.5) * dx
    X, Y = np.meshgrid(x, x)
    X, Y = X.ravel(), Y.ravel()
    G = np.exp(-((X[:, None] - centers[None, :, 0]) ** 2 + (Y[:, None] - centers[None, :, 1]) ** 2) / (4 * sigma ** 2)).astype(np.complex128)
    return G / np.linalg.norm(G, axis=0)


def build_configs(n, dx, pixel, odd):
    margin = int(np.ceil(n / 2 - FOV_HALF / dx))  # field of view ±FOV_HALF (inside lens-aperture vignetting and the absorbing taper)
    cfgs = []
    for ps in [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]:
        centers, k = lattice(n, dx, ps, margin, odd)
        K = len(centers)
        if K > 1200 or k < 3:
            continue
        for sf in [0.25, 0.4]:
            sigma = max(sf * ps * dx, 0.3 * dx)
            G = basis(n, dx, centers, sigma)
            bits = rng.integers(0, 2, size=(K, NPAT))
            checker = np.exp(1j * np.pi * ((np.arange(K) % k + np.arange(K) // k) % 2))[:, None]
            randph = np.exp(2j * np.pi * rng.random((K, 1)))
            pair_a = np.array([i for i in range(K) if (i % k) % 2 == 0 and (i % k) + 1 < k])
            pair_b = pair_a + 1
            pbits = rng.integers(0, 2, size=(len(pair_a), NPAT))
            dr = np.zeros((K, NPAT), complex); dr[pair_a] = 1 - pbits; dr[pair_b] = pbits
            m = 0.5
            df = np.zeros((K, NPAT), complex)
            df[pair_a] = np.sqrt((1 + m * (1 - 2 * pbits)) / 2); df[pair_b] = np.sqrt((1 - m * (1 - 2 * pbits)) / 2)
            pats = {
                'presence_phase0': (bits.astype(complex), bits),
                'presence_checker': (bits * checker, bits),
                'presence_randphase': (bits * randph, bits),
                'phase_0pi': (np.where(bits == 1, -1.0, 1.0).astype(complex), bits),
                'dual_rail': (dr, pbits),
                'differential': (df, pbits),
            }
            mid = (k // 2) * k + k // 2
            xs = (np.arange(n) - n / 2 + 0.5) * dx
            XX, YY = np.meshgrid(xs, xs); XX, YY = XX.ravel(), YY.ravel()
            half = max(0.4 * ps * dx, 0.5 * dx)
            Dsq = np.stack([((np.abs(XX - cx) <= half + 1e-12) & (np.abs(YY - cy) <= half + 1e-12)).astype(float) for cx, cy in centers])
            Dsq /= Dsq.sum(1, keepdims=True)
            cols = [G @ v for v, _ in pats.values()] + [G @ np.ones((K, 1), complex), G[:, [mid]]]
            cfgs.append(dict(ps=ps, pitch_um=ps * dx * 1e6, pitch_px=ps * dx / pixel, sigma=sigma, k=k, K=K, centers=centers, G=G, pats=pats, pair_a=pair_a, pair_b=pair_b, mid=mid, Dsq=Dsq, X=np.concatenate(cols, axis=1)))
    return cfgs, margin


def analyse(cfg, Y, t, name, t_rt, dx):
    G, K, mid, ps = cfg['G'], cfg['K'], cfg['mid'], cfg['ps']
    A = G.conj().T @ Y
    Pw = np.abs(A) ** 2
    Psq = cfg['Dsq'] @ (np.abs(Y) ** 2)  # physical detector: mean intensity over a 0.8·pitch square per cell
    D = np.hypot(*(cfg['centers'] - cfg['centers'][mid]).T)
    row = dict(operator=name, pitch_samples=ps, pitch_um=cfg['pitch_um'], pitch_px=cfg['pitch_px'], sigma_um=cfg['sigma'] * 1e6, cells=K, t=t, time_s=t * t_rt,
               states_per_mm2_cell=1e-6 / (cfg['pitch_um'] * 1e-6) ** 2)
    pi = Pw[:, -1]
    self_p = pi[mid]
    nn = pi[(D > 0.5 * ps * dx) & (D < 1.1 * ps * dx)]
    nnn = pi[(D > 1.3 * ps * dx) & (D < 1.5 * ps * dx)]
    tot = max(float(np.sum(np.abs(Y[:, -1]) ** 2)), 1e-300)
    row.update(self_retention=float(self_p), impulse_total=tot, nn_xtalk=float(nn.max() / self_p) if self_p > 0 else np.nan,
               nnn_xtalk=float(nnn.max() / self_p) if nnn.size and self_p > 0 else np.nan, impulse_leak=float(1 - self_p / tot))
    col = 0
    for enc, (v, b) in cfg['pats'].items():
        Pe, Ae = Pw[:, col:col + NPAT], A[:, col:col + NPAT]
        col += NPAT
        Pq = Psq[:, col - NPAT:col]
        if enc.startswith('presence'):
            for dname, M_ in (('', Pe), ('_sq', Pq)):
                # per-cell calibrated threshold (fixed per cell and horizon): midpoint of that cell's on/off medians
                thr_k = np.array([0.5 * (np.median(M_[i][b[i] == 1]) + np.median(M_[i][b[i] == 0])) if (b[i] == 1).any() and (b[i] == 0).any() else np.inf for i in range(M_.shape[0])])
                row[f'{enc}{dname}cal_ber'] = float(np.mean((M_ > thr_k[:, None]).astype(int) != b))
                if dname:
                    on_, off_ = M_[b == 1], M_[b == 0]
                    row[f'{enc}_sq_ber'] = float(np.mean((M_ > 0.5 * (np.median(on_) + np.median(off_))).astype(int) != b))
            on, off = Pe[b == 1], Pe[b == 0]
            thr = 0.5 * (np.median(on) + np.median(off))  # fixed decoder per (lattice, t): midpoint of the medians
            row[f'{enc}_ber'] = float(np.mean((Pe > thr).astype(int) != b))
            row[f'{enc}_margin'] = float((on.min() - off.max()) / np.mean(on))
            row[f'{enc}_false_act'] = float(off.max() / np.mean(on))
        elif enc == 'phase_0pi':
            ref = A[:, -2]
            proj = np.real(Ae * np.conj(ref)[:, None])
            dec = (proj < 0).astype(int)
            row['phase_0pi_ber'] = float(np.mean(dec != b))
            row['phase_0pi_margin'] = float(np.min(np.where(dec == b, 1, -1) * np.abs(proj)) / np.mean(np.abs(proj)))
        else:
            a, bb = Pe[cfg['pair_a']], Pe[cfg['pair_b']]
            row[f'{enc}_ber'] = float(np.mean((bb > a).astype(int) != b))
            aq, bq = Pq[cfg['pair_a']], Pq[cfg['pair_b']]
            row[f'{enc}_sq_ber'] = float(np.mean((bq > aq).astype(int) != b))
            row[f'{enc}_margin'] = float(np.min((bb - a) * (2 * b - 1) / (a + bb)))
    return row


def run(name, maxlog2=20):
    M, meta = cp.load(name)
    n, dx = meta['n'], meta['dx']
    t_rt = meta['roundTripTime']
    pixel = {'A': 20e-6, 'B': 63.5e-6, 'C': 63.5e-6}[name[0]]
    Mn = M / cp.lam1(name)
    del M
    cfgs, margin = build_configs(n, dx, pixel, odd=name.startswith('C'))
    widths = [c['X'].shape[1] for c in cfgs]
    X = np.concatenate([c['X'] for c in cfgs], axis=1)
    offs = np.cumsum([0] + widths)
    print(name, 'configs', len(cfgs), 'columns', X.shape[1], flush=True)
    rows = []
    t0 = time.time()

    def emit(Y, t):
        for i, c in enumerate(cfgs):
            rows.append(analyse(c, Y[:, offs[i]:offs[i + 1]], t, name, t_rt, dx))
        r = [q for q in rows if q['t'] == t]
        print(f't={t} [{time.time()-t0:.0f}s] ' + ' '.join(f"p{q['pitch_samples']}/{q['sigma_um']:.0f}:{q['presence_phase0_ber']:.2f},{q['dual_rail_ber']:.2f},{q['phase_0pi_ber']:.2f}" for q in r[::2]), flush=True)

    emit(X, 0)
    Y = Mn @ X
    emit(Y, 1)
    S = Mn
    for k in range(1, maxlog2 + 1):
        Y = S @ Y
        emit(Y, 2 ** k)
        if k < maxlog2:
            S = S @ S
    json.dump(dict(operator=name, n=n, dx=dx, pixel=pixel, t_rt=t_rt, margin_samples=margin, fov_half=FOV_HALF, rows=rows), open(os.path.join(OUT, f'packing_{name}{os.environ.get("TAG", "")}.json'), 'w'))


if __name__ == '__main__':
    run(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 20)
