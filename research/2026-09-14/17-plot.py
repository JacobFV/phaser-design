"""Experiment 17 plots: closed-loop tracking error vs optical recurrences per sensor frame."""
import glob, json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D = os.path.join(os.path.dirname(__file__), 'out', '17')
fig, axs = plt.subplots(1, 2, figsize=(13, 4.5))
rows_all = []
for f in sorted(glob.glob(os.path.join(D, 'control_*.json'))):
    tag = os.path.basename(f)[len('control_'):-5]
    rows = json.load(open(f))
    rows_all += [dict(r, run=tag) for r in rows]
    opt = sorted([r for r in rows if r['model'].startswith('optical')], key=lambda r: r['K'])
    if opt:
        K = [r['K'] for r in opt]
        axs[0].errorbar(K, [r['track_err'] for r in opt], yerr=[r['track_err_sd'] for r in opt], fmt='o-', capsize=3, label=f'optical {tag}')
        axs[1].plot(K, [r['occluded_err'] for r in opt], 'o-', label=f'optical {tag}')
for name, ls in (('memoryless_linear_on_frame', ':'), ('ESN128', '--'), ('oracle_PD', '-.')):
    b = [r for r in rows_all if r['model'] == name]
    if b:
        axs[0].axhline(b[0]['track_err'], color='k', ls=ls, label=name)
        if b[0]['occluded_err'] == b[0]['occluded_err']:
            axs[1].axhline(b[0]['occluded_err'], color='k', ls=ls, label=name)
for ax, yl in zip(axs, ('mean closed-loop tracking error', 'mean error while target occluded')):
    ax.set_xscale('log'); ax.set_yscale('log'); ax.set_xlabel('optical round trips per sensor frame (K)'); ax.set_ylabel(yl); ax.grid(alpha=0.3, which='both'); ax.legend(fontsize=7)
fig.tight_layout(); fig.savefig(os.path.join(D, 'fig_control_vs_K.png'), dpi=130)
for r in rows_all:
    print('%-12s %-28s K=%-7s track %.3f ± %.3f  occluded %.3f  action_mse %.4f  frame_rate %s' % (r['run'], r['model'], r['K'], r['track_err'], r['track_err_sd'], r['occluded_err'], r['action_mse'], ('%.3g Hz' % r['frame_rate_hz']) if 'frame_rate_hz' in r else '-'))
