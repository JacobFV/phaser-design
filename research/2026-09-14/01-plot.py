"""Experiment 1 plots: correlation / width / leakage vs cycles grouped by width; lifetime vs initial width; snapshots."""
import glob, os, csv, collections
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.join(os.path.dirname(__file__), 'out', '01')
rows = collections.defaultdict(list)
for p in sorted(glob.glob(os.path.join(D, 'dot_*.csv'))):
    with open(p) as fh:
        r = list(csv.DictReader(fh))
    if not r:
        continue
    rows[(r[0]['condition'], float(r[0]['sigma0_um']))] = {k: np.array([float(x[k]) for x in r]) for k in r[0] if k != 'condition'}

conds = sorted({c for c, _ in rows})
T_RT = {'B_4f': 2.669e-9, 'C_mla': 2.77e-10}


def panel(metric, fname, ylabel, logy=False, ylim=None):
    n = len(conds)
    cols = min(3, n)
    fig, axs = plt.subplots((n + cols - 1) // cols, cols, figsize=(5.2 * cols, 3.6 * ((n + cols - 1) // cols)), squeeze=False)
    for ax, c in zip(axs.ravel(), conds):
        sig = sorted(s for cc, s in rows if cc == c)
        cmap = plt.cm.viridis(np.linspace(0, 0.95, len(sig)))
        for col, s in zip(cmap, sig):
            d = rows[(c, s)]
            x = np.maximum(d['cycle'], 0.7)
            ax.plot(x, d[metric], color=col, lw=1.4, label=f"σ={s:g} µm ({d['sigma0_pixels'][0]:.2g} px)")
        ax.set_xscale('log')
        if logy:
            ax.set_yscale('log')
        if ylim:
            ax.set_ylim(*ylim)
        ax.set_title(c)
        ax.set_xlabel('round trips')
        ax.set_ylabel(ylabel)
        ax.grid(alpha=0.3)
        ax.legend(fontsize=6.5, ncol=2)
    for ax in axs.ravel()[n:]:
        ax.axis('off')
    fig.tight_layout()
    fig.savefig(os.path.join(D, fname), dpi=130)
    plt.close(fig)


panel('corr', 'fig_corr_vs_cycles.png', 'intensity correlation with launched dot', ylim=(-0.05, 1.02))
panel('width_ratio', 'fig_width_vs_cycles.png', 'rms width / initial', logy=True)
panel('leakage', 'fig_leakage_vs_cycles.png', 'power outside max(3σ, 2 px)', ylim=(-0.02, 1.02))
panel('fidelity', 'fig_fidelity_vs_cycles.png', 'complex fidelity', ylim=(-0.02, 1.02))
panel('driftLocal_um', 'fig_drift_vs_cycles.png', 'local centroid drift (µm)')

# lifetime vs width: first checkpoint violating a criterion; censored if never violated
crit = {'corr<0.9': lambda d: d['corr'] < 0.9, 'corr<0.5': lambda d: d['corr'] < 0.5, 'width×>1.5': lambda d: d['width_ratio'] > 1.5, 'leak>0.2': lambda d: d['leakage'] > 0.2}
summary = []
fig, axs = plt.subplots(1, len(crit), figsize=(5 * len(crit), 3.8))
for ax, (cn, fn) in zip(axs, crit.items()):
    for c in conds:
        sig = sorted(s for cc, s in rows if cc == c)
        L, cens = [], []
        for s in sig:
            d = rows[(c, s)]
            bad = np.nonzero(fn(d))[0]
            if len(bad):
                L.append(d['cycle'][bad[0]]); cens.append(False)
            else:
                L.append(d['cycle'][-1]); cens.append(True)
            summary.append(dict(condition=c, sigma_um=s, sigma_px=d['sigma0_pixels'][0], sigma_samples=d['sigma0_samples'][0], criterion=cn, lifetime_cycles=L[-1], censored=cens[-1], horizon=d['cycle'][-1], t_rt=d['time_s'][1] / max(d['cycle'][1], 1)))
        L = np.maximum(np.array(L), 0.7)
        line, = ax.plot(sig, L, '-', lw=1, label=c)
        cens = np.array(cens)
        ax.plot(np.array(sig)[~cens], L[~cens], 'o', color=line.get_color(), ms=4)
        ax.plot(np.array(sig)[cens], L[cens], '^', color=line.get_color(), ms=6, mfc='none')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.set_xlabel('initial σ (µm, intensity rms)'); ax.set_ylabel('lifetime (round trips)')
    ax.set_title(f'lifetime: first {cn}  (△ = survived whole run)')
    ax.grid(alpha=0.3, which='both')
axs[0].legend(fontsize=7)
fig.tight_layout()
fig.savefig(os.path.join(D, 'fig_lifetime_vs_width.png'), dpi=130)
with open(os.path.join(D, 'lifetime_summary.csv'), 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(summary[0]))
    w.writeheader(); w.writerows(summary)

# snapshots
for c in conds:
    snaps = sorted(glob.glob(os.path.join(D, f'snap_{c}_s*_c*.f64')))
    if not snaps:
        continue
    sig = sorted({int(p.split('_s')[-1].split('_c')[0]) for p in snaps})
    cyc = sorted({int(p.split('_c')[-1].split('.')[0]) for p in snaps})
    fig, axs = plt.subplots(len(sig), len(cyc) + 1, figsize=(1.9 * (len(cyc) + 1), 1.9 * len(sig)), squeeze=False)
    for i, s in enumerate(sig):
        for j, cc in enumerate([0] + cyc):
            ax = axs[i, j]; ax.set_xticks([]); ax.set_yticks([])
            p = os.path.join(D, f'snap_{c}_s{s}_c{cc}.f64')
            if cc == 0 or not os.path.exists(p):
                continue
            I = np.fromfile(p)
            n = int(np.sqrt(I.size))
            ax.imshow(np.sqrt(I.reshape(n, n) / I.max()), cmap='magma', origin='lower')
            if i == 0: ax.set_title(f'c={cc}', fontsize=8)
            if j == 1: ax.set_ylabel(f'σ={s}µm', fontsize=8)
    fig.suptitle(f'{c}: √intensity (normalised)', fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(D, f'fig_snaps_{c}.png'), dpi=110)
    plt.close(fig)
print('ok', len(rows), 'traces')
