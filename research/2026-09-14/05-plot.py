"""Experiment 5 plots: eigenvalue lifetime spectra for every analysed operator."""
import glob, json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.join(os.path.dirname(__file__), 'out', '05')
names = [os.path.basename(p)[:-13] for p in sorted(glob.glob(os.path.join(D, '*_spectrum.npz')))]
fig, axs = plt.subplots(2, 2, figsize=(13, 9))
table = []
for nm in names:
    z = np.load(os.path.join(D, nm + '_spectrum.npz'))
    s = json.load(open(os.path.join(D, nm + '_summary.json')))
    tau = np.minimum(z['tau_rel'], 1e16)
    rank = np.arange(1, len(tau) + 1)
    axs[0, 0].loglog(rank, tau, label=nm)
    axs[0, 1].scatter(z['pr'][:400], tau[:400], s=4, label=nm)
    rel = np.abs(z['w']) / np.abs(z['w'][0])
    axs[1, 0].plot(rank[:600], rel[:600], label=nm)
    table.append((nm, s['abs1'], s['t_rt'], s['modes_tau_rel_gt'], s['modes_tau_abs_gt']))
axs[0, 0].set_xlabel('mode rank'); axs[0, 0].set_ylabel('τ_rel (round trips), gain clamped at mode 1'); axs[0, 0].axhline(1e5, ls=':', c='k'); axs[0, 0].axhline(1e3, ls=':', c='gray')
axs[0, 0].set_ylim(0.1, 1e16); axs[0, 0].legend(fontsize=7); axs[0, 0].grid(alpha=0.3, which='both')
axs[0, 1].set_xscale('log'); axs[0, 1].set_yscale('log'); axs[0, 1].set_xlabel('participation ratio (samples)'); axs[0, 1].set_ylabel('τ_rel'); axs[0, 1].set_ylim(0.1, 1e16); axs[0, 1].grid(alpha=0.3)
axs[1, 0].set_xlabel('mode rank'); axs[1, 0].set_ylabel('|λ_k| / |λ_1|'); axs[1, 0].grid(alpha=0.3)
ax = axs[1, 1]; ax.axis('off')
txt = 'operator     |λ1|    t_rt(ns)  modes with τ_rel > 10/100/1e3/1e4/1e5\n'
for nm, a1, trt, c, ca in table:
    txt += f"{nm:12s} {a1:.3f}  {trt*1e9:6.3f}   {c['10']}/{c['100']}/{c['1000']}/{c['10000']}/{c['100000']}\n"
ax.text(0, 1, txt, family='monospace', fontsize=9, va='top')
fig.tight_layout()
fig.savefig(os.path.join(D, 'fig_eigen_lifetime_spectrum.png'), dpi=130)
plt.close(fig)

for nm in names:
    p = os.path.join(D, nm + '_modes64.npy')
    if not os.path.exists(p):
        continue
    m = np.load(p)
    z = np.load(os.path.join(D, nm + '_spectrum.npz'))
    fig, axs = plt.subplots(4, 8, figsize=(16, 8.4))
    for k, ax in enumerate(axs.ravel()):
        ax.imshow(np.sqrt(m[k] / m[k].max()), cmap='magma', origin='lower'); ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f"#{k} τ={min(z['tau_rel'][k], 9.9e15):.2g} PR={z['pr'][k]:.0f}", fontsize=7)
    fig.suptitle(f'{nm}: leading eigenmodes (√|v|²)')
    fig.tight_layout()
    fig.savefig(os.path.join(D, f'fig_modes_{nm}.png'), dpi=100)
    plt.close(fig)
print(txt)
