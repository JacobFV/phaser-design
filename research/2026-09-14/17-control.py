"""Experiment 17: streaming control-policy toy.

 target moves in 2-D (smooth random acceleration, periodic occlusions); agent is a double integrator;
 egocentric camera frame (16×16 px, Gaussian target blob relative to agent, sensor noise) is injected every K round trips;
 the optical state is NEVER reset; a digital linear readout of binned detector intensities outputs 2-D acceleration.

Optical dynamics between frames use the EXACT explicit round-trip operator of the chosen static configuration (linear
optics + constant gain just below threshold), x ← M^K (x + B·frame), M^K by repeated squaring (validated against JS to
1e-11 at 1e5 trips). Readout features: |x|² binned 16×16 (square-law detection) + bias.

Policy readout trained by ridge regression on expert actions (behaviour cloning, 2 DAgger rounds). Evaluated closed loop.
Baselines: memoryless P controller on the current frame centroid; ESN-128 (tanh) with the same readout protocol; oracle PD.

usage: python 17-control.py <operator> <K,...>
"""
import json, math, os, sys, time
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module
cp = import_module('04-coupling')

OUT = os.path.join(os.path.dirname(__file__), 'out', '17')
os.makedirs(OUT, exist_ok=True)

FR = 16          # camera frame pixels
DT = 1.0         # frame period (arbitrary units)
KP = 0.5
AMAX = 0.4  # max commanded agent velocity per frame (single-integrator agent: action = velocity command)


def make_target(steps, seed, occl=True):
    rng = np.random.default_rng(seed)
    p = np.zeros((steps, 2)); v = np.zeros(2); x = np.zeros(2)
    vis = np.ones(steps, bool)
    for t in range(steps):
        v = 0.97 * v + 0.03 * rng.normal(size=2)
        x = x + v * DT
        p[t] = x
        if occl and (t % 120) >= 100:
            vis[t] = False
    return p, vis


def camera(rel, visible, rng, noise):
    """egocentric frame: target blob at rel (units: frame half-width = 6)."""
    g = (np.arange(FR) - FR / 2 + 0.5) / (FR / 2) * 6
    X, Y = np.meshgrid(g, g)
    img = np.exp(-((X - rel[0]) ** 2 + (Y - rel[1]) ** 2) / (2 * 0.8 ** 2)) if visible else np.zeros((FR, FR))
    img = img + noise * rng.normal(size=img.shape)
    return img


def expert(rel, vt):
    """expert velocity command: proportional pursuit plus the target's true velocity (feed-forward; unobservable from one frame)."""
    return np.clip(KP * rel + vt, -AMAX, AMAX)


class Optical:
    def __init__(self, name, K, gain_margin=float(os.environ.get('GAIN_MARGIN', '0.995')), seed=0):
        M, meta = cp.load(name)
        self.n = meta['n']
        lam = cp.lam1(name)
        Mn = (M / lam) * gain_margin  # constant gain just below threshold: dominant mode decays as 0.995^K
        # M^K by binary composition (full matrix; K up to 1e6 ≈ 20 squarings)
        R = None; S = Mn; k = K
        while k:
            if k & 1:
                R = S.copy() if R is None else S @ R
            k >>= 1
            if k:
                S = S @ S
        self.MK = R
        self.t_rt = meta['roundTripTime']
        rng = np.random.default_rng(seed)
        # input coupling: each frame pixel drives a smooth random complex pattern in the central region
        n = self.n
        x = np.arange(n) - n / 2 + 0.5
        X, Y = np.meshgrid(x, x)
        B = np.zeros((n * n, FR * FR), complex)
        for p in range(FR * FR):
            cx, cy = rng.uniform(-18, 18, 2)
            B[:, p] = (np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (2 * 2.5 ** 2)) * np.exp(2j * np.pi * rng.random((n, n)))).ravel()
        self.B = B * 0.15
        self.reset()

    def reset(self):
        self.x = np.zeros(self.n * self.n, complex)

    def step(self, frame):
        self.x = self.MK @ (self.x + self.B @ frame.ravel())
        I = np.abs(self.x.reshape(self.n, self.n)) ** 2
        b = self.n // 16
        return np.log10(I.reshape(16, b, 16, b).mean((1, 3)).ravel() + 1e-9)


class ESN:
    def __init__(self, N=128, seed=0):
        rng = np.random.default_rng(seed)
        W = rng.normal(size=(N, N)); W *= 0.95 / np.max(np.abs(np.linalg.eigvals(W)))
        self.W, self.Win = W, rng.normal(size=(N, FR * FR)) * 0.3
        self.N = N
        self.reset()

    def reset(self):
        self.h = np.zeros(self.N)

    def step(self, frame):
        self.h = np.tanh(self.W @ self.h + self.Win @ frame.ravel())
        return self.h.copy()


class Memoryless:
    def reset(self):
        pass

    def step(self, frame):
        return frame.ravel().copy()


def episode(policy, reservoir, steps, seed, noise, w=None, dagger_beta=0.0, record=False):
    """closed loop if w given; returns features, expert actions, errors."""
    rng = np.random.default_rng(seed + 1000)
    tgt, vis = make_target(steps, seed)
    pos = np.zeros(2); vel = np.zeros(2)
    reservoir.reset()
    F, A, err, occl_err, traj = [], [], [], [], []
    for t in range(steps):
        rel = tgt[t] - pos
        vt = (tgt[t] - tgt[t - 1]) / DT if t else np.zeros(2)
        frame = camera(rel, vis[t], rng, noise)
        f = reservoir.step(frame)
        a_exp = expert(rel, vt)
        F.append(f); A.append(a_exp)
        if w is not None and rng.random() >= dagger_beta:
            a = np.clip(np.append(f, 1) @ w, -AMAX, AMAX)
        else:
            a = a_exp
        vel = a
        pos = pos + vel * DT
        e = np.linalg.norm(tgt[t] - pos)
        err.append(e)
        if not vis[t]:
            occl_err.append(e)
        if record:
            traj.append((tgt[t].copy(), pos.copy(), vis[t]))
    return np.array(F), np.array(A), np.array(err), np.array(occl_err), traj


def fit(F, A, lam):
    Z = np.hstack([F, np.ones((len(F), 1))])
    mu = np.zeros(Z.shape[1]); sd = np.ones(Z.shape[1])
    return np.linalg.solve(Z.T @ Z + lam * np.eye(Z.shape[1]), Z.T @ A)


def train_and_eval(res, noise, steps=600, n_train=6, n_test=4, lam_grid=(1e-3, 1e-1, 10.0)):
    Fs, As = [], []
    for s in range(n_train):
        F, A, *_ = episode('expert', res, steps, s, noise)
        Fs.append(F[20:]); As.append(A[20:])
    best = None
    for lam in lam_grid:
        w = fit(np.vstack(Fs[:-1]), np.vstack(As[:-1]), lam)
        F, A = Fs[-1], As[-1]
        e = np.mean((np.clip(np.hstack([F, np.ones((len(F), 1))]) @ w, -AMAX, AMAX) - A) ** 2)
        if best is None or e < best[0]:
            best = (e, lam)
    w = fit(np.vstack(Fs), np.vstack(As), best[1])
    for rnd in range(2):  # DAgger: states visited by the learned policy, labelled by the expert
        for s in range(n_train):
            F, A, *_ = episode('mix', res, steps, 100 + rnd * 10 + s, noise, w=w, dagger_beta=0.3)
            Fs.append(F[20:]); As.append(A[20:])
        w = fit(np.vstack(Fs), np.vstack(As), best[1])
    errs, oerrs, amse = [], [], []
    for s in range(n_test):
        F, A, e, oe, _ = episode('policy', res, steps, 500 + s, noise, w=w)
        errs.append(e[50:].mean()); oerrs.append(oe.mean() if len(oe) else np.nan)
        amse.append(np.mean((np.clip(np.hstack([F, np.ones((len(F), 1))]) @ w, -AMAX, AMAX) - A) ** 2))
    return dict(track_err=float(np.mean(errs)), track_err_sd=float(np.std(errs)), occluded_err=float(np.nanmean(oerrs)), action_mse=float(np.mean(amse)), lam=best[1]), w


def oracle(noise, steps=600, n_test=4):
    errs = []
    for s in range(n_test):
        tgt, vis = make_target(steps, 500 + s)
        pos = np.zeros(2); vel = np.zeros(2); e = []
        for t in range(steps):
            rel = tgt[t] - pos
            vt = (tgt[t] - tgt[t - 1]) / DT if t else np.zeros(2)
            a = expert(rel, vt)
            vel = a; pos = pos + vel * DT
            e.append(np.linalg.norm(tgt[t] - pos))
        errs.append(np.mean(e[50:]))
    return float(np.mean(errs))


if __name__ == '__main__':
    name = sys.argv[1]
    Ks = [int(k) for k in sys.argv[2].split(',')]
    noises = [float(x) for x in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['0.05'])]
    results = []
    for noise in noises:
        r0, _ = train_and_eval(Memoryless(), noise)
        results.append(dict(model='memoryless_linear_on_frame', K=0, noise=noise, **r0))
        print('memoryless', noise, r0, flush=True)
        r1, _ = train_and_eval(ESN(), noise)
        results.append(dict(model='ESN128', K=0, noise=noise, **r1))
        print('ESN128', noise, r1, flush=True)
        results.append(dict(model='oracle_PD', K=0, noise=noise, track_err=oracle(noise), track_err_sd=0, occluded_err=np.nan, action_mse=0, lam=0))
        for K in Ks:
            t0 = time.time()
            res = Optical(name, K)
            r, w = train_and_eval(res, noise)
            r.update(model=f'optical_{name}', K=K, noise=noise, gain_margin=float(os.environ.get('GAIN_MARGIN', '0.995')), t_rt=res.t_rt, frame_period_s=K * res.t_rt, frame_rate_hz=1 / (K * res.t_rt))
            results.append(r)
            print(name, 'K', K, noise, r, f'[{time.time()-t0:.0f}s]', flush=True)
            json.dump(results, open(os.path.join(OUT, f"control_{name}{os.environ.get('TAG', '')}.json"), 'w'), indent=1)
    json.dump(results, open(os.path.join(OUT, f"control_{name}{os.environ.get('TAG', '')}.json"), 'w'), indent=1)
