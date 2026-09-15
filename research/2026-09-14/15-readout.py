"""Experiment 15 readout: ridge regression from optical features (digital, evaluation only)."""
import glob, json, os, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.join(os.path.dirname(__file__), 'out', '15')
WASH, TRAIN = 200, 2200


def ridge_eval(X, y, lam_grid=(1e-6, 1e-4, 1e-2, 1)):
    """train on [WASH, TRAIN), choose λ on the last 20 % of train, report test on [TRAIN, end)."""
    Xtr, ytr = X[WASH:TRAIN], y[WASH:TRAIN]
    Xte, yte = X[TRAIN:], y[TRAIN:]
    ntr = len(Xtr)
    cut = int(ntr * 0.8)
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-12
    Z = lambda A: np.hstack([(A - mu) / sd, np.ones((len(A), 1))])
    best = None
    for lam in lam_grid:
        A = Z(Xtr[:cut]); w = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ ytr[:cut])
        err = np.mean((Z(Xtr[cut:]) @ w - ytr[cut:]) ** 2)
        if best is None or err < best[0]:
            best = (err, lam)
    A = Z(Xtr); w = np.linalg.solve(A.T @ A + best[1] * np.eye(A.shape[1]), A.T @ ytr)
    return Z(Xte) @ w, yte


def narma10(u):
    y = np.zeros_like(u)
    for t in range(9, len(u) - 1):
        y[t + 1] = 0.3 * y[t] + 0.05 * y[t] * y[t - 9:t + 1].sum() + 1.5 * u[t - 9] * u[t] + 0.1
    return y


def analyse(feat_uni, feat_bits, u, b):
    X = np.log10(feat_uni + 1e-12)
    Xb = np.log10(feat_bits + 1e-12)
    res = {}
    mc = []
    for k in range(0, 61):
        y = np.roll(u, k); y[:k] = 0
        p, yt = ridge_eval(X, y)
        r2 = np.corrcoef(p, yt)[0, 1] ** 2 if np.std(p) > 0 else 0
        mc.append(float(r2))
    res['mc_curve'] = mc
    res['memory_capacity'] = float(sum(mc[1:]))
    res['max_delay_r2_gt_0.5'] = int(max([k for k in range(1, 61) if mc[k] > 0.5], default=0))
    res['max_delay_r2_gt_0.1'] = int(max([k for k in range(1, 61) if mc[k] > 0.1], default=0))
    # delayed XOR / parity on bits
    acc = {}
    for d in range(0, 11):
        y = np.logical_xor(np.roll(b, d), np.roll(b, d + 1)).astype(float); y[:d + 2] = 0
        p, yt = ridge_eval(Xb, y)
        acc[f'xor_d{d}'] = float(np.mean((p > 0.5) == (yt > 0.5)))
        y3 = (np.roll(b, d) + np.roll(b, d + 1) + np.roll(b, d + 2)) % 2; y3[:d + 3] = 0
        p, yt = ridge_eval(Xb, y3)
        acc[f'parity3_d{d}'] = float(np.mean((p > 0.5) == (yt > 0.5)))
        # linear-memory control on the same bits (a linear readout of a linear system can recall bits but not XOR them)
        yb = np.roll(b, d).astype(float); yb[:d] = 0
        p, yt = ridge_eval(Xb, yb)
        acc[f'recall_d{d}'] = float(np.mean((p > 0.5) == (yt > 0.5)))
    res['bits'] = acc
    y = narma10(u)
    p, yt = ridge_eval(X, y)
    res['narma10_nmse'] = float(np.mean((p - yt) ** 2) / np.var(yt))
    sv = np.linalg.svd(X[WASH:] - X[WASH:].mean(0), compute_uv=False)
    res['feature_eff_rank_99'] = int(np.searchsorted(np.cumsum(sv ** 2) / np.sum(sv ** 2), 0.99) + 1)
    res['feature_participation'] = float(sv.sum() ** 2 / (sv ** 2).sum())
    return res


def baselines(u, b):
    """digital calibration: delay-line (tapped) input features and an ESN of 256 tanh units."""
    out = {}
    rng = np.random.default_rng(0)
    for name, gen in [('tapped_delay_8', None), ('esn256', None)]:
        if name.startswith('tapped'):
            F = lambda s: np.stack([np.roll(s, k) for k in range(8)], 1)
        else:
            W = rng.normal(size=(256, 256)); W *= 0.9 / np.max(np.abs(np.linalg.eigvals(W)))
            Win = rng.normal(size=256)
            bias = rng.normal(size=256)  # without a bias an odd tanh on ±1 inputs has no even-order (product) terms and cannot XOR

            def F(s):
                h = np.zeros(256); H = []
                for x in s:
                    h = np.tanh(W @ h + Win * (x - 0.25) * 4 + bias); H.append(h.copy())
                return np.array(H)
        Fu, Fb = F(u), F(b * 0.5)
        r = {}
        mc = []
        for k in range(0, 61):
            y = np.roll(u, k); y[:k] = 0
            p, yt = ridge_eval(Fu, y)
            mc.append(float(np.corrcoef(p, yt)[0, 1] ** 2) if np.std(p) > 0 else 0)
        r['memory_capacity'] = float(sum(mc[1:])); r['mc_curve'] = mc
        y = narma10(u); p, yt = ridge_eval(Fu, y); r['narma10_nmse'] = float(np.mean((p - yt) ** 2) / np.var(yt))
        acc = {}
        for d in range(0, 11):
            yx = np.logical_xor(np.roll(b, d), np.roll(b, d + 1)).astype(float); yx[:d + 2] = 0
            p, yt = ridge_eval(Fb, yx); acc[f'xor_d{d}'] = float(np.mean((p > 0.5) == (yt > 0.5)))
        r['bits'] = acc
        out[name] = r
    return out


if __name__ == '__main__':
    u = np.fromfile(os.path.join(D, 'inputs_uniform.f64'))
    b = np.fromfile(os.path.join(D, 'inputs_bits.f64'))
    results = {}
    kfilter = sys.argv[1] if len(sys.argv) > 1 else '*'
    for jf in sorted(glob.glob(os.path.join(D, f'feat_*_K{kfilter}_uniform.json'))):
        meta = json.load(open(jf))
        key = f"{meta['opName']}_K{meta['K']}"
        fb = jf.replace('_uniform.json', '_bits.f64')
        if not os.path.exists(fb):
            continue
        Fu = np.fromfile(jf.replace('.json', '.f64')).reshape(meta['steps'], 256)
        Fb = np.fromfile(fb).reshape(meta['steps'], 256)
        r = analyse(Fu, Fb, u[:meta['steps']], b[:meta['steps']])
        r.update(op=meta['opName'], K=meta['K'], note=meta['note'], t_rt=meta['t_rt'], step_time_s=meta['K'] * meta['t_rt'], maxI=meta['maxI'])
        results[key] = r
        print(key, 'MC=%.2f' % r['memory_capacity'], 'maxdelay(r2>.5)=%d' % r['max_delay_r2_gt_0.5'], 'NARMA10 NMSE=%.3f' % r['narma10_nmse'], 'xor_d0=%.3f xor_d2=%.3f par3_d0=%.3f' % (r['bits']['xor_d0'], r['bits']['xor_d2'], r['bits']['parity3_d0']), 'rank99=%d' % r['feature_eff_rank_99'])
    base = baselines(u[:3200], b[:3200])
    for k, v in base.items():
        print(k, 'MC=%.2f NARMA10=%.3f xor_d0=%.3f' % (v['memory_capacity'], v['narma10_nmse'], v['bits']['xor_d0']))
    json.dump(dict(optical=results, digital=base), open(os.path.join(D, f'reservoir_results_K{kfilter}.json'.replace('*', 'all')), 'w'), indent=1)
    # plots
    fig, axs = plt.subplots(1, 3, figsize=(17, 4.5))
    for key, r in sorted(results.items()):
        axs[0].plot(range(1, 61), r['mc_curve'][1:], label=f"{key} (MC {r['memory_capacity']:.1f})")
        axs[1].plot(range(11), [r['bits'][f'xor_d{d}'] for d in range(11)], 'o-', ms=3, label=key)
    for k, v in base.items():
        axs[0].plot(range(1, 61), v['mc_curve'][1:], 'k--' if 'esn' in k else 'k:', label=f"{k} (MC {v['memory_capacity']:.1f})")
        axs[1].plot(range(11), [v['bits'][f'xor_d{d}'] for d in range(11)], 'k--' if 'esn' in k else 'k:', label=k)
    axs[0].set_xlabel('delay k (input steps)'); axs[0].set_ylabel('r² of u(t−k) reconstruction'); axs[0].legend(fontsize=6); axs[0].grid(alpha=0.3)
    axs[1].set_xlabel('delay d'); axs[1].set_ylabel('accuracy: u(t−d) XOR u(t−d−1)'); axs[1].axhline(0.5, c='gray', ls=':'); axs[1].legend(fontsize=6); axs[1].grid(alpha=0.3)
    keys = sorted(results)
    axs[2].bar(range(len(keys)), [results[k]['narma10_nmse'] for k in keys])
    axs[2].axhline(base['esn256']['narma10_nmse'], c='k', ls='--', label='ESN-256'); axs[2].axhline(base['tapped_delay_8']['narma10_nmse'], c='k', ls=':', label='8-tap linear')
    axs[2].set_xticks(range(len(keys))); axs[2].set_xticklabels(keys, rotation=60, fontsize=7); axs[2].set_ylabel('NARMA10 NMSE'); axs[2].legend(fontsize=7)
    fig.tight_layout(); fig.savefig(os.path.join(D, f'fig_reservoir_K{kfilter}.png'.replace('*', 'all')), dpi=130)
