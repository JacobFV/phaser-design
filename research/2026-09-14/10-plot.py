"""Experiment 10 plots: autonomous state progression traces from re-entrant static optics."""
import csv, glob, json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D = os.path.join(os.path.dirname(__file__), 'out', '10')
runs = []
for j in sorted(glob.glob(os.path.join(D, 'clock_*.json'))):
    s = json.load(open(j))
    rows = list(csv.DictReader(open(j.replace('.json', '.csv'))))
    runs.append((s, rows))
fig, axs = plt.subplots(2, 2, figsize=(15, 9))
for s, rows in runs:
    if s['noiseRel'] != 0:
        continue
    lab = f"q={s['q']} p={s['p']}{' NL' if s['nonlinear'] else ''} ({s['slmPower_D']:.1f} D)"
    t = np.array([float(r['t']) for r in rows]); ov = np.array([float(r['best_overlap']) for r in rows]); ok = np.array([int(r['ok']) for r in rows])
    axs[0, 0].semilogx(t, ov, '.', ms=3, label=lab)
    axs[0, 1].semilogx(t, np.array([float(r['contrast']) for r in rows]), '.', ms=3, label=lab)
    early = [r for r in rows if float(r['t']) <= 4 * s['q'] + s['q']]
    axs[1, 0].step([float(r['t']) for r in early], [int(r['decoded']) + 0.05 * s['q'] for r in early], where='mid', label=lab)
axs[0, 0].set_xlabel('round trips'); axs[0, 0].set_ylabel('overlap with the matching reference state'); axs[0, 0].legend(fontsize=7); axs[0, 0].grid(alpha=0.3)
axs[0, 1].set_xlabel('round trips'); axs[0, 1].set_ylabel('one-hot contrast (best/second overlap)'); axs[0, 1].set_yscale('log'); axs[0, 1].grid(alpha=0.3)
axs[1, 0].set_xlabel('round trip'); axs[1, 0].set_ylabel('decoded state index'); axs[1, 0].set_title('decoded sequence, first cycles (noise 0)'); axs[1, 0].legend(fontsize=7); axs[1, 0].grid(alpha=0.3)
for s, rows in runs:
    if s['nonlinear']:
        continue
    axs[1, 1].plot(max(s['noiseRel'], 1e-5), s['first_sequence_error'] or s['horizon'], 'o', label=f"q={s['q']}" if s['noiseRel'] == 0 else None, color=f"C{[2,5,7,12].index(s['q'])}")
axs[1, 1].set_xscale('log'); axs[1, 1].set_yscale('log'); axs[1, 1].set_xlabel('additive noise power per trip (relative; 1e-5 = none)'); axs[1, 1].set_ylabel('first sequence error (trips)'); axs[1, 1].legend(); axs[1, 1].grid(alpha=0.3)
fig.tight_layout(); fig.savefig(os.path.join(D, 'fig_clock.png'), dpi=130)
fmt = lambda v, f: ('%' + f) % v if isinstance(v, (int, float)) else str(v)
for s, rows in runs:
    print('q=%-2s p=%s noise=%-6s nl=%-5s P=%s D  horizon=%-6s first_error=%-6s ok=%s  min_contrast=%s  late_overlap=%s  rows=%d' % (
        s['q'], s['p'], s['noiseRel'], s['nonlinear'], fmt(s.get('slmPower_D'), '.2f'), s['horizon'], s['first_sequence_error'],
        fmt(s.get('decoded_fraction_ok'), '.3f'), fmt(s.get('min_contrast'), '.3g'), fmt(s.get('late_mean_best_overlap'), '.3f'), len(rows)))
