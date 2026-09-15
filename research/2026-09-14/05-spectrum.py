"""Experiment 5: eigen-spectrum of explicit round-trip operators dumped by 05-extract.ts.

Outputs per operator (out/05/<name>_*.npz|csv) and a combined plot. Lifetimes:
  tau_abs = -1/ln|lambda|              passive cavity, no gain
  tau_rel = -1/ln(|lambda|/|lambda_1|) with gain clamped so the dominant mode sits at threshold (saturated laser)
"""
import json, sys, time, os
import numpy as np

BIG = '/private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/big/'
OUT = os.path.join(os.path.dirname(__file__), 'out', '05')
os.makedirs(OUT, exist_ok=True)


def load(name):
    meta = json.load(open(BIG + name + '.json'))
    n = meta['n']
    N = n * n
    M = np.fromfile(BIG + name + '.c128', dtype=np.complex128).reshape(N, N).T.copy()  # file is column-major
    return M, meta


def analyse(name):
    M, meta = load(name)
    n, dx = meta['n'], meta['dx']
    N = n * n
    t = time.time()
    w, V = np.linalg.eig(M)
    order = np.argsort(-np.abs(w))
    w, V = w[order], V[:, order]
    el = time.time() - t
    a = np.abs(w)
    with np.errstate(divide='ignore'):
        tau_abs = np.where(a < 1, -1 / np.log(np.maximum(a, 1e-300)), np.inf)
        rel = a / a[0]
        tau_rel = np.where(rel < 1, -1 / np.log(np.maximum(rel, 1e-300)), np.inf)
    P = np.abs(V) ** 2
    P /= P.sum(0, keepdims=True)
    pr = 1 / (P ** 2).sum(0)  # participation ratio in samples
    ii, jj = np.meshgrid((np.arange(n) - n / 2 + 0.5) * dx, (np.arange(n) - n / 2 + 0.5) * dx)
    x, y = ii.ravel(), jj.ravel()
    cx, cy = (P * x[:, None]).sum(0), (P * y[:, None]).sum(0)
    rms = np.sqrt(((P * x[:, None] ** 2).sum(0) - cx ** 2 + (P * y[:, None] ** 2).sum(0) - cy ** 2) / 2)
    # non-normality: condition of eigenvector basis on the leading 200 modes, overlaps between them
    K = min(200, N)
    Vk = V[:, :K] / np.linalg.norm(V[:, :K], axis=0)
    G = np.abs(Vk.conj().T @ Vk)
    np.fill_diagonal(G, 0)
    counts = {h: int((tau_rel > h).sum()) for h in [10, 100, 1000, 10000, 100000]}
    counts_abs = {h: int((tau_abs > h).sum()) for h in [1, 10, 100, 1000]}
    summary = dict(name=name, n=n, dx=dx, t_rt=meta['roundTripTime'], eig_seconds=el, lambda1=complex(w[0]).__repr__(), abs1=float(a[0]),
                   modes_tau_rel_gt=counts, modes_tau_abs_gt=counts_abs,
                   leading200_max_overlap=float(G.max()), leading200_mean_overlap=float(G.sum() / (K * (K - 1))),
                   top10=[dict(abs=float(a[k]), arg=float(np.angle(w[k])), tau_rel=float(tau_rel[k]), pr_samples=float(pr[k]), rms_um=float(rms[k] * 1e6), cx_um=float(cx[k] * 1e6), cy_um=float(cy[k] * 1e6)) for k in range(10)])
    np.savez_compressed(os.path.join(OUT, name + '_spectrum.npz'), w=w, pr=pr, rms=rms, cx=cx, cy=cy, tau_rel=tau_rel, tau_abs=tau_abs)
    # keep leading eigenvectors for plots (intensity only, 64 modes)
    np.save(os.path.join(OUT, name + '_modes64.npy'), (np.abs(V[:, :64]) ** 2).astype(np.float32).T.reshape(64, n, n))
    json.dump(summary, open(os.path.join(OUT, name + '_summary.json'), 'w'), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    for name in sys.argv[1:]:
        analyse(name)
