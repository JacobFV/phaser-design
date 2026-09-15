"""Experiments 18 (architecture sensitivity) and 19 (wavelength): collect the already-measured quantities per configuration
into comparison tables and figures. No new simulation here — every number is read from out/ of Experiments 1–17.
"""
import csv, glob, json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

R = os.path.dirname(__file__)
O = lambda *p: os.path.join(R, 'out', *p)
os.makedirs(O('18'), exist_ok=True)
os.makedirs(O('19'), exist_ok=True)


def jload(p, default=None):
    try:
        return json.load(open(p))
    except Exception:
        return default


def spectrum(name):
    s = jload(O('05', f'{name}_summary.json'))
    if not s:
        return {}
    return dict(t_rt_ns=s['t_rt'] * 1e9, rt_rate_GHz=1 / s['t_rt'] / 1e9, retention_per_trip=s['abs1'] ** 2, required_gain=1 / s['abs1'] ** 2,
                modes_gt_1e2=s['modes_tau_rel_gt']['100'], modes_gt_1e3=s['modes_tau_rel_gt']['1000'], modes_gt_1e5=s['modes_tau_rel_gt']['100000'])


def coupling(name):
    c = jload(O('04', f'coupling_{name}.json'))
    if not c:
        return {}
    h = {x['t']: x for x in c['horizons']}
    return dict(coupling_radius_t128_um=h[128]['r_interaction_um'], coupling_rank_t128=f"{h[128]['rank_gt_0p01']}/{c['cells']}", coupling_rank_t16384=f"{h[16384]['rank_gt_0p01']}/{c['cells']}", self_t128=h[128]['self_mean'])


def frontier(opkey):
    p = O('02', 'frontier_summary.csv')
    if not os.path.exists(p):
        return {}
    rows = [r for r in csv.DictReader(open(p)) if r['operator'] == opkey and r['ber_max'] == '0.0']
    best = {}
    for need in (128, 1024):
        ok = [r for r in rows if int(float(r['lifetime_trips'])) >= need]
        if ok:
            r = max(ok, key=lambda r: float(r['bits_per_mm2']))
            best[f'max_states_per_mm2_life_ge_{need}'] = round(float(r['bits_per_mm2']), 1)
            best[f'pitch_um_life_ge_{need}'] = round(float(r['pitch_um']))
        else:
            best[f'max_states_per_mm2_life_ge_{need}'] = 0
    best['max_lifetime_any_trips'] = max((int(float(r['lifetime_trips'])) for r in rows), default=0)
    return best


def dot_lifetime(cond):
    p = O('01', 'lifetime_summary.csv')
    if not os.path.exists(p):
        return {}
    rows = [r for r in csv.DictReader(open(p)) if r['condition'] == cond and r['criterion'] == 'corr<0.9']
    if not rows:
        return {}
    r = max(rows, key=lambda r: float(r['lifetime_cycles']))
    return dict(best_dot_corr09_trips=float(r['lifetime_cycles']), best_dot_sigma_um=float(r['sigma_um']))


def reservoir(op):
    res = {}
    for f in glob.glob(O('15', 'reservoir_results_K*.json')):
        d = jload(f)
        for k, v in (d or {}).get('optical', {}).items():
            if v['op'] == op:
                res[f"MC_K{v['K']}"] = round(v['memory_capacity'], 1)
                res[f"NARMA10_K{v['K']}"] = round(v['narma10_nmse'], 3)
    return res


ARCH = [
    dict(arch='A reflective SLM ring (self-imaging)', spectrum='A_img', coupling='A_img', packing='A_img_fov200', dots='img', reservoir='Apre_lin'),
    dict(arch='A reflective SLM ring (preset relay)', spectrum='A_preset', coupling=None, packing=None, dots='preset', reservoir='Apre_lin'),
    dict(arch='B linear reciprocal LCD 4f', spectrum='B_4f', coupling='B_4f', packing='B_4f_fov400' if os.path.exists(O('02', 'packing_B_4f_fov400.json')) else 'B_4f', dots='B_4f', reservoir='B_sat'),
    dict(arch='B lensless (shipped preset style)', spectrum='B_flat', coupling=None, packing=None, dots=None, reservoir=None),
    dict(arch='C cheap LCD + MLA', spectrum='C_mla', coupling='C_mla', packing='C_mla', dots='C_mla', reservoir='C_sat'),
]


def logic_summary():
    out = {}
    for f in sorted(glob.glob(O('08', 'eval_*_10000.json'))):
        d = jload(f)
        if not d:
            continue
        ok = [r['survived_to'] >= d['horizon'] and r['acc_train_window'] == 1.0 for r in d['results']]
        out[d['tag']] = dict(cases=len(ok), cases_correct_to_1e4=sum(ok))
    return out


if __name__ == '__main__':
    table = []
    for a in ARCH:
        row = dict(arch=a['arch'])
        row.update(spectrum(a['spectrum']))
        if a['coupling']:
            row.update(coupling(a['coupling']))
        if a['packing']:
            row.update(frontier(a['packing']))
        if a['dots']:
            row.update(dot_lifetime(a['dots']))
        if a['reservoir']:
            row.update(reservoir(a['reservoir']))
        table.append(row)
    keys = sorted({k for r in table for k in r}, key=lambda k: (k != 'arch', k))
    with open(O('18', 'architecture_comparison.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=keys); w.writeheader(); w.writerows(table)
    json.dump(dict(architectures=table, logic=logic_summary()), open(O('18', 'architecture_comparison.json'), 'w'), indent=1)
    for r in table:
        print(r)
    print('logic', logic_summary())

    # figure: architecture comparison
    fig, axs = plt.subplots(1, 4, figsize=(20, 4.2))
    names = [r['arch'].split(' (')[0][:22] + ('\n(' + r['arch'].split(' (')[1] if ' (' in r['arch'] else '') for r in table]
    def bar(ax, key, title, log=False):
        v = [r.get(key, np.nan) for r in table]
        ax.bar(range(len(v)), [x if x == x else 0 for x in v], color=['C0', 'C0', 'C1', 'C1', 'C2'])
        ax.set_xticks(range(len(v))); ax.set_xticklabels(names, fontsize=6.5, rotation=30, ha='right'); ax.set_title(title, fontsize=9)
        if log: ax.set_yscale('log')
    bar(axs[0], 'modes_gt_1e3', 'modes with τ_rel > 1e3 trips', log=True)
    bar(axs[1], 'best_dot_corr09_trips', 'best single-dot lifetime (corr ≥ 0.9, trips)', log=True)
    bar(axs[2], 'required_gain', 'required round-trip power gain')
    bar(axs[3], 'rt_rate_GHz', 'round trips per second (GHz)')
    fig.tight_layout(); fig.savefig(O('18', 'fig_architecture_comparison.png'), dpi=130); plt.close(fig)

    # Experiment 19: wavelength
    wl = []
    for base in ('A_img', 'B_4f'):
        for lam, suffix in ((450, '_450'), (532, '_532'), (650, '')):
            name = base + suffix
            row = dict(config=base, wavelength_nm=lam)
            row.update(spectrum(name))
            row.update(coupling(name))
            fov = '_fov200' if base == 'A_img' else '_fov400'
            row.update(frontier(name + fov))
            wl.append(row)
    keys = sorted({k for r in wl for k in r}, key=lambda k: (k not in ('config', 'wavelength_nm'), k))
    with open(O('19', 'wavelength_comparison.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=keys); w.writeheader(); w.writerows(wl)
    for r in wl:
        print(r)
    fig, axs = plt.subplots(1, 3, figsize=(15, 4))
    for base, mk in (('A_img', 'o-'), ('B_4f', 's-')):
        rr = [r for r in wl if r['config'] == base]
        lam = [r['wavelength_nm'] for r in rr]
        axs[0].plot(lam, [r.get('modes_gt_1e5', np.nan) for r in rr], mk, label=f'{base} τ>1e5')
        axs[0].plot(lam, [r.get('modes_gt_1e3', np.nan) for r in rr], mk, alpha=0.5, label=f'{base} τ>1e3')
        axs[1].plot(lam, [r.get('coupling_radius_t128_um', np.nan) for r in rr], mk, label=base)
        axs[2].plot(lam, [r.get('max_states_per_mm2_life_ge_128', np.nan) for r in rr], mk, label=f'{base} life≥128')
        axs[2].plot(lam, [r.get('max_states_per_mm2_life_ge_1024', np.nan) for r in rr], mk, alpha=0.5, label=f'{base} life≥1024')
    lam = np.array([450, 532, 650])
    axs[0].plot(lam, 85 * (650 / lam) ** 2, 'k:', label='85·(650/λ)²')
    axs[0].set_xlabel('λ (nm)'); axs[0].set_ylabel('long-lived modes'); axs[0].legend(fontsize=7); axs[0].grid(alpha=0.3)
    axs[1].set_xlabel('λ (nm)'); axs[1].set_ylabel('coupling radius at t=128 (µm)'); axs[1].legend(fontsize=7); axs[1].grid(alpha=0.3)
    axs[2].set_xlabel('λ (nm)'); axs[2].set_ylabel('max states/mm² (BER=0)'); axs[2].legend(fontsize=7); axs[2].grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(O('19', 'fig_wavelength.png'), dpi=130); plt.close(fig)
