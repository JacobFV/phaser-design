"""Experiments 2 & 3 plots/tables from out/02/packing_<op>.json (linear, gain-clamped operators)."""
import glob, json, os, csv
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.join(os.path.dirname(__file__), 'out', '02')
ENC = ['presence_phase0', 'presence_phase0_sq', 'presence_phase0_sqcal', 'presence_randphase_sqcal', 'phase_0pi', 'dual_rail', 'dual_rail_sq', 'differential_sq']
BITS_PER_CELL = {'presence_phase0': 1, 'presence_phase0_sq': 1, 'presence_phase0_sqcal': 1, 'presence_randphase_sqcal': 1, 'phase_0pi': 1, 'dual_rail': 0.5, 'dual_rail_sq': 0.5, 'differential_sq': 0.5}


def load():
    out = {}
    for p in sorted(glob.glob(os.path.join(D, 'packing_*.json'))):
        d = json.load(open(p))
        key = os.path.basename(p)[len('packing_'):-len('.json')]  # operator + optional FOV tag
        d['operator'] = key
        for r in d['rows']:
            r['operator'] = key
        out[key] = d
    return out


def lifetime(rows, enc, ber_max, key='ber'):
    """largest power-of-two horizon t such that BER ≤ ber_max at every recorded horizon ≤ t (0 = fails at t=1)."""
    rows = sorted(rows, key=lambda r: r['t'])
    life = 0
    for r in rows:
        if r['t'] == 0:
            continue
        if r[f'{enc}_{key}'] <= ber_max:
            life = r['t']
        else:
            break
    return life


def main():
    data = load()
    summary = []
    for op, d in data.items():
        rows = d['rows']
        t_rt = d['t_rt']
        fov = (2 * d['fov_half'] * 1e3) ** 2  # mm²
        configs = sorted({(r['pitch_samples'], r['sigma_um']) for r in rows})
        # ── BER vs horizon per encoding, for each pitch (σ = 0.4·pitch) ──
        fig, axs = plt.subplots(2, 4, figsize=(21, 8.5), sharex=True, sharey=True)
        for ax, enc in zip(axs.ravel(), ENC):
            pitches = sorted({p for p, s in configs})
            cm = plt.cm.viridis(np.linspace(0, 0.95, len(pitches)))
            for col, ps in zip(cm, pitches):
                sig = max(s for p, s in configs if p == ps)
                rr = sorted([r for r in rows if r['pitch_samples'] == ps and r['sigma_um'] == sig and r['t'] > 0], key=lambda r: r['t'])
                ax.plot([r['t'] for r in rr], [max(r[f'{enc}_ber'], 1e-3) for r in rr], 'o-', ms=2.5, color=col, label=f"{rr[0]['pitch_um']:.0f} µm ({rr[0]['pitch_px']:.2g} px)")
            ax.set_xscale('log'); ax.set_yscale('log'); ax.set_ylim(8e-4, 0.7)
            ax.set_title(f'{op}: {enc} (σ = 0.4·pitch)', fontsize=9); ax.grid(alpha=0.3, which='both')
            ax.axhline(0.01, c='r', ls=':', lw=0.8)
        axs[0, 0].legend(fontsize=6); axs[1, 0].set_xlabel('round trips'); axs[1, 1].set_xlabel('round trips'); axs[1, 2].set_xlabel('round trips')
        axs[0, 0].set_ylabel('BER (floor 1e-3 = 0 errors in 24 patterns)'); axs[1, 0].set_ylabel('BER')
        fig.tight_layout(); fig.savefig(os.path.join(D, f'fig_ber_vs_t_{op}.png'), dpi=120); plt.close(fig)

        # ── cross-talk vs pitch at selected horizons ──
        fig, axs = plt.subplots(1, 3, figsize=(15, 4))
        for ax, key in zip(axs, ['nn_xtalk', 'nnn_xtalk', 'self_retention']):
            for t in [1, 16, 256, 4096, 65536, 1048576]:
                rr = sorted([r for r in rows if r['t'] == t and abs(r['sigma_um'] - 0.4 * r['pitch_um']) < 1e-6 or (r['t'] == t and r['pitch_samples'] == 1)], key=lambda r: r['pitch_um'])
                if rr:
                    ax.plot([r['pitch_um'] for r in rr], [max(r[key], 1e-8) if r[key] == r[key] else np.nan for r in rr], 'o-', ms=3, label=f't={t}')
            ax.set_xscale('log'); ax.set_yscale('log'); ax.set_xlabel('cell pitch (µm)'); ax.set_title(f'{op}: {key}'); ax.grid(alpha=0.3, which='both'); ax.legend(fontsize=6)
        fig.tight_layout(); fig.savefig(os.path.join(D, f'fig_xtalk_vs_pitch_{op}.png'), dpi=120); plt.close(fig)

        # ── frontier: density vs lifetime (best σ per pitch) per encoding and BER threshold ──
        for ber_max in [0.0, 0.01, 0.05]:
            for enc in ENC:
                for ps in sorted({p for p, s in configs}):
                    best = None
                    for sig in sorted({s for p, s in configs if p == ps}):
                        rr = [r for r in rows if r['pitch_samples'] == ps and r['sigma_um'] == sig]
                        L = lifetime(rr, enc, ber_max)
                        if best is None or L > best[0]:
                            best = (L, sig, rr[0])
                    L, sig, r0 = best
                    dens = BITS_PER_CELL[enc] / (r0['pitch_um'] * 1e-3) ** 2
                    summary.append(dict(operator=op, encoding=enc, ber_max=ber_max, pitch_um=r0['pitch_um'], pitch_px=r0['pitch_px'], sigma_um=sig, bits_per_mm2=dens,
                                        lifetime_trips=L, lifetime_s=L * t_rt, bits_in_fov=int(dens * fov), fov_mm2=fov, censored=L >= max(r['t'] for r in rows)))
    with open(os.path.join(D, 'frontier_summary.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(summary[0])); w.writeheader(); w.writerows(summary)

    # central plots across operators
    ops = list(data)
    for ber_max in [0.0, 0.01]:
        fig, axs = plt.subplots(1, 3, figsize=(18, 5))
        for op in ops:
            t_rt = data[op]['t_rt']
            for enc, mk in [('presence_phase0_sqcal', 'o'), ('dual_rail_sq', 's'), ('phase_0pi', '^')]:
                ss = sorted([s for s in summary if s['operator'] == op and s['encoding'] == enc and s['ber_max'] == ber_max], key=lambda s: s['bits_per_mm2'])
                x = [s['bits_per_mm2'] for s in ss]; L = [max(s['lifetime_trips'], 0.5) for s in ss]
                axs[0].plot(x, L, mk + '-', ms=4, label=f'{op} {enc}')
                axs[1].plot(x, [l * t_rt for l in L], mk + '-', ms=4, label=f'{op} {enc}')
                axs[2].plot([max(l, 0.5) for l in L], [s['bits_in_fov'] for s in ss], mk + '-', ms=4, label=f'{op} {enc}')
        axs[0].set_xscale('log'); axs[0].set_yscale('log'); axs[0].set_xlabel('logical states / mm²'); axs[0].set_ylabel('usable lifetime (round trips, powers of 2)')
        axs[0].set_title(f'density × lifetime frontier (BER ≤ {ber_max}, linear gain-clamped)')
        axs[1].set_xscale('log'); axs[1].set_yscale('log'); axs[1].set_xlabel('logical states / mm²'); axs[1].set_ylabel('usable lifetime (s)')
        axs[2].set_xscale('log'); axs[2].set_yscale('log'); axs[2].set_xlabel('usable lifetime (round trips)'); axs[2].set_ylabel('simultaneously usable states in FOV')
        for ax in axs:
            ax.grid(alpha=0.3, which='both')
        axs[0].legend(fontsize=6)
        fig.tight_layout(); fig.savefig(os.path.join(D, f'fig_frontier_ber{ber_max}.png'), dpi=130); plt.close(fig)

    # capacity vs allowed error/cross-talk threshold at fixed horizons
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.5))
    for op in ops:
        rows = data[op]['rows']
        for t, ls in [(1, '-'), (256, '--'), (4096, ':')]:
            thr_list = [1e-4, 1e-3, 1e-2, 3e-2, 1e-1]
            cap_x, cap_b = [], []
            for thr in thr_list:
                ok = [r for r in rows if r['t'] == t and r['nn_xtalk'] == r['nn_xtalk'] and r['nn_xtalk'] <= thr]
                cap_x.append(max([1e-6 / (r['pitch_um'] * 1e-6) ** 2 for r in ok], default=np.nan))
                okb = [r for r in rows if r['t'] == t and min(r['dual_rail_ber'], r['phase_0pi_ber']) <= thr]
                cap_b.append(max([(1 if r['phase_0pi_ber'] <= thr else 0.5) * 1e-6 / (r['pitch_um'] * 1e-6) ** 2 for r in okb], default=np.nan))
            axs[0].plot(thr_list, cap_x, 'o' + ls, label=f'{op} t={t}')
            axs[1].plot(thr_list, cap_b, 'o' + ls, label=f'{op} t={t}')
    axs[0].set_xscale('log'); axs[0].set_yscale('log'); axs[0].set_xlabel('allowed nearest-neighbour power cross-talk'); axs[0].set_ylabel('max cells / mm²'); axs[0].grid(alpha=0.3, which='both'); axs[0].legend(fontsize=6)
    axs[1].set_xscale('log'); axs[1].set_yscale('log'); axs[1].set_xlabel('allowed BER (best of dual-rail / phase)'); axs[1].set_ylabel('max logical states / mm²'); axs[1].grid(alpha=0.3, which='both')
    fig.tight_layout(); fig.savefig(os.path.join(D, 'fig_capacity_vs_threshold.png'), dpi=130); plt.close(fig)
    print('rows', len(summary))


if __name__ == '__main__':
    main()
