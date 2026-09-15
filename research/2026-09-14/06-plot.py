"""Experiment 6 regime diagrams from out/06/regime_*.csv + analytic per-sample bistability map."""
import glob, os, csv
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap

D = os.path.join(os.path.dirname(__file__), 'out', '06')
rows = []
for p in glob.glob(os.path.join(D, 'regime_*.csv')):
    with open(p) as fh:
        for r in csv.DictReader(fh):
            if 'cellPx' in r and float(r['T']) >= 3000:
                rows.append({k: (float(v) if k not in ('mask', 'energy_trace') else v) for k, v in r.items()})

CLASSES = ['extinct (trivial attractor)', 'strong contraction', 'long-memory stable', 'near-critical', 'chaotic/expanding', 'saturated/lasing everywhere']
COLORS = ['#222222', '#4575b4', '#1a9850', '#fee08b', '#d73027', '#f46d43']


def classify(r):
    if r['energy_final_rel'] < 1e-6 or r['max_cell_I'] < 1e-6:
        return 0
    if r['fill_fraction'] > 0.35:
        return 5
    lam = r['lyapunov']
    if lam > 1e-3:
        return 4
    if r['ber'] <= 0.02 and r['pattern_corr_T_vs_0'] > 0.9:
        return 2
    if abs(lam) <= 1e-3:
        return 3
    return 1


T_PASSIVE = 0.684


def analytic(G0, s, Ia=0.05, Ig=1.0, T=T_PASSIVE):
    I = np.logspace(-4, 2, 4000)
    r = T * (1 + (G0 - 1) / (1 + I / Ig)) * (1 + s / (1 + I / Ia))
    off_stable = T * G0 * (1 + s) < 1
    on_exists = (r > 1).any()
    if off_stable and on_exists:
        return 2  # bistable
    if not off_stable:
        return 1  # off unstable → lasing from noise
    return 0  # monostable off


groups = sorted({(r['mask'], int(r['cellPx']), int(r['pitchPx']), r['kerr']) for r in rows})
fig, axs = plt.subplots(2, max(3, (len(groups) + 1) // 2), figsize=(5 * max(3, (len(groups) + 1) // 2), 9), squeeze=False)
for ax, g in zip(axs.ravel(), groups):
    rr = [r for r in rows if (r['mask'], int(r['cellPx']), int(r['pitchPx']), r['kerr']) == g]
    G = sorted({r['G0'] for r in rr}); S = sorted({r['s'] for r in rr})
    Z = np.full((len(S), len(G)), np.nan)
    L = np.full((len(S), len(G)), np.nan)
    for r in rr:
        Z[S.index(r['s']), G.index(r['G0'])] = classify(r)
        L[S.index(r['s']), G.index(r['G0'])] = r['lyapunov']
    ax.imshow(Z, cmap=ListedColormap(COLORS), vmin=-0.5, vmax=5.5, origin='lower', aspect='auto')
    for i in range(len(S)):
        for j in range(len(G)):
            if not np.isnan(L[i, j]):
                ax.text(j, i, f'{L[i,j]:.0e}\n{analytic(G[j], S[i])}', ha='center', va='center', fontsize=5.5, color='w' if Z[i, j] in (0, 1, 4) else 'k')
    ax.set_xticks(range(len(G))); ax.set_xticklabels(G, fontsize=7); ax.set_yticks(range(len(S))); ax.set_yticklabels(S, fontsize=7)
    ax.set_xlabel('small-signal gain G0 (local saturation)'); ax.set_ylabel('absorber strength s')
    ax.set_title(f'mask={g[0]} cell {g[1]}px pitch {g[2]}px κ={g[3]}', fontsize=9)
for ax in axs.ravel()[len(groups):]:
    ax.axis('off')
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in COLORS]
fig.legend(handles, CLASSES, loc='lower center', ncol=6, fontsize=8)
fig.suptitle('Regime map (text: largest Lyapunov exponent per trip; analytic per-sample map 0=monostable-off 1=off-unstable 2=bistable)', fontsize=10)
fig.tight_layout(rect=(0, 0.04, 1, 0.97))
fig.savefig(os.path.join(D, 'fig_regime_map.png'), dpi=130)

with open(os.path.join(D, 'regime_classified.csv'), 'w', newline='') as fh:
    keys = [k for k in rows[0] if k != 'energy_trace'] + ['class', 'analytic']
    w = csv.DictWriter(fh, fieldnames=keys)
    w.writeheader()
    for r in rows:
        q = {k: r[k] for k in keys[:-2]}
        q['class'] = CLASSES[classify(r)]
        q['analytic'] = ['monostable-off', 'off-unstable', 'bistable'][analytic(r['G0'], r['s'])]
        w.writerow(q)
print(len(rows), 'rows')
