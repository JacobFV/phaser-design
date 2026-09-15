"""Experiments 4 (+5 validation, +1 long horizon): matrix powers of the explicit round-trip operators.

 - validate: numpy M^t x0 against the direct JS evolution dumped by 05-validate.ts
 - coupling: T_t[j,k] = <g_j| (M/|λ1|)^t |g_k> for a regular lattice of Gaussian cells, t = 1..128 (and beyond)
 - dots: long-horizon (to 2^20 ≈ 1.05e6) evolution of single dots via repeated squaring
"""
import json, os, sys, time
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

BIG = '/private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/big/'
OUT = os.path.join(os.path.dirname(__file__), 'out', '04')
os.makedirs(OUT, exist_ok=True)


def load(name):
    meta = json.load(open(BIG + name + '.json'))
    n = meta['n']
    M = np.fromfile(BIG + name + '.c128', dtype=np.complex128).reshape(n * n, n * n).T.copy()
    return M, meta


def lam1(name):
    s = json.load(open(os.path.join(os.path.dirname(__file__), 'out', '05', name + '_summary.json')))
    return s['abs1']


def gaussian(n, dx, sigma, cx, cy):
    x = (np.arange(n) - n / 2 + 0.5) * dx
    X, Y = np.meshgrid(x, x)
    g = np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (4 * sigma ** 2)).ravel().astype(np.complex128)
    return g / np.linalg.norm(g)


def evolve(Mn, X, ts):
    """{t: Mn^t @ X} for integer t, walking the binary expansion with only the current square in memory."""
    ts = sorted(set(ts))
    res = {}
    cur = {t: X.copy() for t in ts}
    S = Mn
    bit = 1
    while bit <= ts[-1]:
        for t in ts:
            if t & bit:
                cur[t] = S @ cur[t]
        bit <<= 1
        if bit <= ts[-1]:
            S = S @ S
    return cur


def powers(Mn, ts):
    """Back-compat: yields (t, callable applying Mn^t) is not memory-safe; kept only for small t."""
    raise NotImplementedError


def validate(name):
    M, meta = load(name)
    js = json.load(open(BIG + f'val_{name}.json'))
    x0 = np.fromfile(BIG + f'val_{name}_c0.c128', dtype=np.complex128)
    marks = sorted(int(k) for k in js['logE'])
    res = []
    lam = lam1(name)
    ev = evolve(M / lam, x0[:, None], marks)
    for t in marks:
        y = ev[t][:, 0]
        z = np.fromfile(BIG + f'val_{name}_c{t}.c128', dtype=np.complex128)
        fid = abs(np.vdot(y, z)) ** 2 / (np.vdot(y, y).real * np.vdot(z, z).real)
        relerr = np.linalg.norm(y / np.linalg.norm(y) * np.exp(-1j * np.angle(np.vdot(z, y))) - z / np.linalg.norm(z))
        logE_np = 2 * np.log(np.linalg.norm(y) / np.linalg.norm(x0)) + 2 * t * np.log(lam)
        res.append(dict(t=t, fidelity_np_vs_js=float(fid), rel_err=float(relerr), logE_np=float(logE_np), logE_js=js['logE'][str(t)]))
        print(name, res[-1])
    json.dump(res, open(os.path.join(OUT, f'validate_{name}.json'), 'w'), indent=1)


def cell_lattice(n, dx, spacing, sigma, margin):
    half = n * dx / 2 - margin
    k = int(np.floor(2 * half / spacing))
    c = (np.arange(k) - (k - 1) / 2) * spacing
    centers = [(x, y) for y in c for x in c]
    G = np.stack([gaussian(n, dx, sigma, x, y) for x, y in centers], axis=1)
    return np.array(centers), G, k


def coupling(name, spacing, sigma, margin, horizons=(1, 2, 4, 8, 16, 32, 64, 128, 1024, 16384)):
    M, meta = load(name)
    n, dx = meta['n'], meta['dx']
    Mn = M / lam1(name)
    centers, G, k = cell_lattice(n, dx, spacing, sigma, margin)
    K = len(centers)
    D = np.hypot(centers[:, None, 0] - centers[None, :, 0], centers[:, None, 1] - centers[None, :, 1])
    out = dict(name=name, spacing=spacing, sigma=sigma, cells=K, side=k, horizons=[])
    GtG = G.conj().T @ G  # Gram of the (non-orthogonal) cell basis
    mats = {}
    ev = evolve(Mn, G, horizons)
    for t in sorted(ev):
        PG = ev[t]
        T = G.conj().T @ PG  # amplitude coupling
        colpow = np.sum(np.abs(PG) ** 2, axis=0)  # power retained anywhere (relative to gain-clamped dominant mode)
        Pw = np.abs(T) ** 2
        diag = np.diag(Pw)
        off = Pw - np.diag(diag)
        # nearest/next-nearest neighbour
        nn = off[(D > 0.5 * spacing) & (D < 1.5 * spacing)]
        nnn = off[(D > 1.2 * spacing) & (D < 1.6 * spacing)]
        far = off[D > 2.5 * spacing]
        rinter = np.sqrt((off * D ** 2).sum() / max(off.sum(), 1e-300))
        s = np.linalg.svd(T, compute_uv=False)
        p = s / s.sum()
        erank = float(np.exp(-(p * np.log(np.maximum(p, 1e-300))).sum()))
        rank1 = int((s > 1e-1 * s[0]).sum()); rank2 = int((s > 1e-2 * s[0]).sum())
        # radial profile of power coupling
        bins = np.arange(0, D.max() + spacing, spacing)
        prof = [float(off[(D >= b - spacing / 2) & (D < b + spacing / 2)].mean()) if ((D >= b - spacing / 2) & (D < b + spacing / 2)).any() else np.nan for b in bins]
        h = dict(t=t, self_mean=float(diag.mean()), self_min=float(diag.min()), nn_mean=float(nn.mean()), nn_max=float(nn.max()), nnn_mean=float(nnn.mean()) if nnn.size else None,
                 far_max=float(far.max()) if far.size else None, retained_mean=float(colpow.mean()), r_interaction_um=float(rinter * 1e6),
                 svals=s.tolist(), erank_entropy=erank, rank_gt_0p1=rank1, rank_gt_0p01=rank2, radial_bins_um=(bins * 1e6).tolist(), radial_power=prof)
        out['horizons'].append(h)
        mats[t] = T
        print(name, 't', t, {kk: (round(v, 5) if isinstance(v, float) else v) for kk, v in h.items() if kk not in ('svals', 'radial_bins_um', 'radial_power')})
    np.savez_compressed(os.path.join(OUT, f'coupling_{name}.npz'), centers=centers, **{f'T{t}': m for t, m in mats.items()})
    json.dump(out, open(os.path.join(OUT, f'coupling_{name}.json'), 'w'), indent=1)
    plot_coupling(name, out, mats, centers, k, spacing)


def plot_coupling(name, out, mats, centers, k, spacing):
    ts = [h['t'] for h in out['horizons']]
    show = [t for t in ts if t in (1, 8, 128, 16384)]
    fig, axs = plt.subplots(3, len(show), figsize=(3.6 * len(show), 10.2), squeeze=False)
    mid = (k // 2) * k + k // 2
    for j, t in enumerate(show):
        T = mats[t]
        ax = axs[0, j]
        im = ax.imshow(np.log10(np.abs(T) ** 2 + 1e-12), cmap='inferno', vmin=-8, vmax=0)
        ax.set_title(f'{name} t={t}: log10 |T|² (cell→cell)', fontsize=8)
        plt.colorbar(im, ax=ax, fraction=0.046)
        ax = axs[1, j]
        im = ax.imshow(np.log10(np.abs(T[:, mid]).reshape(k, k) ** 2 + 1e-12), cmap='inferno', vmin=-8, vmax=0, origin='lower')
        ax.set_title(f'impulse response from centre cell (t={t})', fontsize=8)
        plt.colorbar(im, ax=ax, fraction=0.046)
        ax = axs[2, j]
        im = ax.imshow(np.angle(T[:, mid]).reshape(k, k), cmap='twilight', vmin=-np.pi, vmax=np.pi, origin='lower')
        ax.set_title('phase of impulse response', fontsize=8)
        plt.colorbar(im, ax=ax, fraction=0.046)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, f'fig_coupling_maps_{name}.png'), dpi=110)
    plt.close(fig)

    fig, axs = plt.subplots(1, 3, figsize=(15, 4))
    cm = plt.cm.plasma(np.linspace(0, 0.9, len(ts)))
    for c, h in zip(cm, out['horizons']):
        axs[0].semilogy(h['radial_bins_um'], h['radial_power'], 'o-', color=c, ms=3, label=f"t={h['t']}")
        s = np.array(h['svals'])
        axs[1].semilogy(np.arange(1, len(s) + 1), s / s[0], color=c, label=f"t={h['t']}")
    axs[0].set_xlabel('cell distance (µm)'); axs[0].set_ylabel('mean |T|² (off-diagonal)'); axs[0].legend(fontsize=6); axs[0].grid(alpha=0.3)
    axs[1].set_xlabel('index'); axs[1].set_ylabel('σ_k/σ_1 of T_t'); axs[1].grid(alpha=0.3)
    axs[2].semilogx(ts, [h['r_interaction_um'] for h in out['horizons']], 'o-', label='power-weighted interaction radius (µm)')
    ax2 = axs[2].twinx()
    ax2.semilogx(ts, [h['rank_gt_0p01'] for h in out['horizons']], 's--', color='C1', label='rank (σ>1% σ1)')
    ax2.semilogx(ts, [h['erank_entropy'] for h in out['horizons']], 'd:', color='C2', label='entropy eff. rank')
    axs[2].set_xlabel('round trips'); axs[2].set_ylabel('interaction radius (µm)'); ax2.set_ylabel(f"rank (of {out['cells']} cells)")
    axs[2].legend(loc='upper left', fontsize=7); ax2.legend(loc='lower right', fontsize=7)
    fig.suptitle(f"{name}: {out['cells']} Gaussian cells σ={out['sigma']*1e6:.0f} µm, pitch {spacing*1e6:.0f} µm")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, f'fig_coupling_stats_{name}.png'), dpi=120)
    plt.close(fig)


def dots(name, sigmas_um, center=(60e-6, 40e-6)):
    """Long-horizon single-dot evolution via repeated squaring; normalised by |λ1| (gain clamp)."""
    M, meta = load(name)
    n, dx = meta['n'], meta['dx']
    Mn = M / lam1(name)
    ts = [1, 10, 100, 1000, 10000, 100000, 1000000]
    X = np.stack([gaussian(n, dx, s * 1e-6, *center) for s in sigmas_um], axis=1)
    x = (np.arange(n) - n / 2 + 0.5) * dx
    XX, YY = np.meshgrid(x, x); XX = XX.ravel(); YY = YY.ravel()
    rows = []
    ev = evolve(Mn, X, ts)
    for t in ts:
        Y = ev[t]
        for j, s in enumerate(sigmas_um):
            y = Y[:, j]; x0 = X[:, j]
            I, I0 = np.abs(y) ** 2, np.abs(x0) ** 2
            corr = np.corrcoef(I, I0)[0, 1]
            fid = abs(np.vdot(x0, y)) ** 2 / (np.vdot(y, y).real * np.vdot(x0, x0).real)
            p = I / I.sum()
            cx, cy = (p * XX).sum(), (p * YY).sum()
            sig = np.sqrt(((p * XX ** 2).sum() - cx ** 2 + (p * YY ** 2).sum() - cy ** 2) / 2)
            R = max(3 * s * 1e-6, 40e-6)
            leak = 1 - p[(XX - center[0]) ** 2 + (YY - center[1]) ** 2 <= R * R].sum()
            rows.append(dict(name=name, sigma_um=s, t=t, corr=float(corr), fidelity=float(fid), width_ratio=float(sig / (s * 1e-6)), leakage=float(leak), retained_rel=float(np.vdot(y, y).real)))
        print(name, t, [(r['sigma_um'], round(r['corr'], 4), round(r['width_ratio'], 3)) for r in rows if r['t'] == t])
    json.dump(rows, open(os.path.join(OUT, f'dots_matrix_{name}.json'), 'w'), indent=1)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'validate':
        for nm in sys.argv[2:]:
            validate(nm)
    elif cmd == 'coupling':
        nm, spacing, sigma, margin = sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
        coupling(nm, spacing, sigma, margin)
    elif cmd == 'dots':
        dots(sys.argv[2], [float(s) for s in sys.argv[3].split(',')])
