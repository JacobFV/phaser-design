"""Experiment 7: wire metrics from the JS re-evaluations (out/08/eval_wire_*_10000.json)."""
import glob, json, os
import numpy as np
D = os.path.join(os.path.dirname(__file__), 'out', '08')
rows = []
for f in sorted(glob.glob(os.path.join(D, 'eval_wire_*_10000.json'))):
    d = json.load(open(f))
    spec = json.load(open(os.path.join(D, d['tag'] + '_spec.json')))
    names = d['names']
    thr = 0.5 * (spec['I_hi'] + spec['I_lo'])
    px = spec['cells']['dst'][0] - spec['cells']['src'][0]
    for r in d['results']:
        if not r['case'].startswith('src1'):
            continue
        tr = r['trace']
        t = np.array([s['t'] for s in tr]); I = np.array([s['I'] for s in tr])
        src, dst = I[:, names.index('src')], I[:, names.index('dst')]
        src0 = src[t == 1][0]
        above = np.nonzero(dst > thr)[0]
        latency = int(t[above[0]]) if len(above) else None
        late = t > spec['T_train'] * 0.5
        hold_ok = [(a > thr) and (b > thr) for a, b in zip(src, dst)]
        spect = [n for n in names if n.startswith('spec')]
        spec_err = 0
        c = next(cc for cc in spec['cases'] if cc['name'] == r['case'])
        specbits = {tg['cell']: tg['value'] for tg in c['targets'] if tg['cell'].startswith('spec')}
        for n in spect:
            v = I[:, names.index(n)]
            spec_err += int(np.sum(((v > thr).astype(int) != specbits[n]) & late))
        rows.append(dict(tag=d['tag'], case=r['case'], distance_px=px, distance_um=px * 20, twin=spec['twin'], T_train=spec['T_train'], latency_trips=latency,
                         transfer_efficiency=float(dst[late].mean() / src0), src_retained=float(src[late].mean() / src0),
                         dst_at_T=float(dst[t == spec['T_train']][0]) if (t == spec['T_train']).any() else None, dst_at_1e4=float(dst[-1]),
                         survived_to=r['survived_to'], first_fail=r['first_fail_extended'], spectator_errors_late=spec_err))
for q in rows:
    print(q)
json.dump(rows, open(os.path.join(D, 'wire_summary.json'), 'w'), indent=1)
