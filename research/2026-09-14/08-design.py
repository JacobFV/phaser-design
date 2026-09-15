"""Static-mask design through the validated torch twin (twin.py) for digital tasks (Experiments 2nl, 7, 8, 9, 10, 11).

One static SLM commanded-phase program (64×64 px) and one static pump level G0 are optimised per task. Every design is
written as a JSON spec (cells, injection schedule, targets, mask file) and RE-EVALUATED in the JS simulator by
08-eval.ts; nothing reported comes from torch.

usage: python 08-design.py <task> '<json overrides>'
"""
import json, math, os, sys, time
import numpy as np
import torch
from torch.utils.checkpoint import checkpoint

sys.path.insert(0, os.path.dirname(__file__))
from twin import Twin

OUT = os.path.join(os.path.dirname(__file__), 'out', '08')
os.makedirs(OUT, exist_ok=True)
torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '3')))

TWIN_ARCH = {  # must match twin-dump.ts TWINS (the JS evaluator rebuilds exactly this config)
    'A64': dict(roof=True, defocus=0), 'A64d2': dict(roof=True, defocus=2e-3), 'A64d5': dict(roof=True, defocus=5e-3),
    'A64d10': dict(roof=True, defocus=10e-3), 'A64noroof': dict(roof=False, defocus=0),
    'A64s_amp': dict(roof=True, defocus=0, maxStep=10e-3, amp_dark=0.0), 'A64sd5_amp': dict(roof=True, defocus=5e-3, maxStep=10e-3, amp_dark=0.0), 'A64s_amp3': dict(roof=True, defocus=0, maxStep=10e-3, amp_dark=1e-3),
    'A64s': dict(roof=True, defocus=0, maxStep=10e-3), 'A64sd5': dict(roof=True, defocus=5e-3, maxStep=10e-3), 'A64snoroof': dict(roof=False, defocus=0, maxStep=10e-3),
}


def square(x0, y0, w, n=64):
    return [(y0 + j) * n + x0 + i for j in range(w) for i in range(w)]


class Problem:
    """cells: name -> [x0, y0, w]; cases: list of dict(name, init_on[], inject[{t, cell, amp, phase}], targets[{cell, value, t_from, t_to}])"""

    def __init__(self, P):
        self.P = P
        self.tw = Twin(P['twin'])
        self.tw.quantize = False
        self.n = self.tw.n
        self.cells = P['cells']
        self.names = list(self.cells)
        self.idx = {k: torch.tensor(square(*v, n=self.n)) for k, v in self.cells.items()}
        self.T = max(max((tg['t_to'] for c in P['cases'] for tg in c['targets']), default=1), max((j['t'] for c in P['cases'] for j in c['inject']), default=0))
        B = len(P['cases'])
        self.B = B
        n = self.n
        # initial field and injection tensors
        E0 = torch.zeros(B, n * n, dtype=torch.complex128)
        for b, c in enumerate(P['cases']):
            for nm in c.get('init_on', []):
                E0[b, self.idx[nm]] = math.sqrt(P['I_init'])
        self.E0 = E0.reshape(B, n, n)
        self.inj = {}
        for b, c in enumerate(P['cases']):
            for j in c['inject']:
                t = j['t']
                if t not in self.inj:
                    self.inj[t] = torch.zeros(B, n * n, dtype=torch.complex128)
                self.inj[t][b, self.idx[j['cell']]] += j['amp'] * complex(math.cos(j['phase']), math.sin(j['phase']))
        self.inj = {t: v.reshape(B, n, n) for t, v in self.inj.items()}
        # target tensors over time: (T+1, B, K) value (nan = don't care)
        K = len(self.names)
        tgt = torch.full((self.T + 1, B, K), float('nan'))
        for b, c in enumerate(P['cases']):
            for tg in c['targets']:
                tgt[tg['t_from']:tg['t_to'] + 1, b, self.names.index(tg['cell'])] = tg['value']
        self.tgt = tgt
        self.cellmask = torch.zeros(n * n, dtype=torch.bool)
        for v in self.idx.values():
            self.cellmask[v] = True
        # parameters
        init = P.get('init_mask')
        # start at mid-stroke: θ = 0 sits on the phase-response clamp (u = 0) where the gradient vanishes
        g0 = torch.Generator().manual_seed(int(P.get('seed', 0)))
        self.theta = torch.nn.Parameter(torch.tensor(np.fromfile(init).reshape(n, n)) if init else math.pi + 0.05 * torch.randn(n, n, generator=g0))
        self.logG = torch.nn.Parameter(torch.tensor(math.log(P['G0'] - 1)))
        # learnable static absorbing amplitude program (only for *_amp twins): logits → drive u ∈ (0, 0.999)
        self.z_amp = None
        if 'amp_dark' in TWIN_ARCH[P['twin']]:
            init_amp = P.get('init_amp')
            if init_amp:
                u0 = np.clip(np.fromfile(init_amp).reshape(n, n) / (2 * math.pi), 1e-4, 0.9989)
                z0 = np.log(u0 / 0.999 / (1 - u0 / 0.999))
            else:
                z0 = np.full((n, n), float(P.get('amp_bg', -4.0)))
                mg = P.get('amp_margin', 0)
                for (x0, y0, w) in self.cells.values():
                    z0[max(0, y0 - mg):y0 + w + mg, max(0, x0 - mg):x0 + w + mg] = 4.0
            self.z_amp = torch.nn.Parameter(torch.tensor(z0))

    def set_media(self):
        G0 = 1 + torch.exp(self.logG)
        P = self.P
        if P.get('linear'):
            for o in self.tw.ops:
                if o['op'] == 'gain':
                    o['G0'] = P['Glin']; o['saturation'] = {'kind': 'none'}; o['noise'] = {'kind': 'none'}
                if o['op'] == 'nonlinear':
                    o['amplitude'] = {'kind': 'none'}; o['phase'] = {'kind': 'none'}
            return G0
        for o in self.tw.ops:
            if o['op'] == 'gain':
                o['G0'] = G0
                o['saturation'] = {'kind': 'local', 'saturationIntensity': P['Ig']}
                o['noise'] = {'kind': 'none'}
            if o['op'] == 'nonlinear':
                o['amplitude'] = {'kind': 'saturable', 'strength': P['s'], 'saturationIntensity': P['Ia']}
                o['phase'] = {'kind': 'kerr', 'coefficient': P['kerr']} if P['kerr'] else {'kind': 'none'}
        return G0

    def masks(self, theta, z):
        m = {'slm': theta}
        if z is not None:
            m['amp'] = 2 * math.pi * 0.999 * torch.sigmoid(z)
        return m

    def cellI(self, E):
        I = (E.real ** 2 + E.imag ** 2).reshape(E.shape[0], -1)
        return torch.stack([I[:, v].mean(1) for v in self.idx.values()], 1)

    def rollout(self, noise=0.0, chunk=10, T=None):
        T = T or self.T
        G0 = self.set_media()
        E = self.E0.clone()
        self.P0 = (E.real ** 2 + E.imag ** 2).sum((1, 2)).detach()
        if noise:
            E = E + noise * (torch.randn_like(E.real) + 1j * torch.randn_like(E.real))
        masks = {'slm': self.theta}
        cI, bg = [self.cellI(E)], []

        def run_chunk(E, theta, z, t0, t1):
            recs, bgs, dEs = [], [], []
            for t in range(t0, t1):
                inj = self.inj.get(t)
                Eprev = E
                E = self.tw.trip(E, self.masks(theta, z), inject=inj)
                # relative whole-field change per trip (fixed-point residual); only used when w_stat > 0
                dEs.append(((E - Eprev).abs() ** 2).sum((1, 2)) / ((E.abs() ** 2).sum((1, 2)) + 1e-12))
                if self.P.get('linear'):
                    if inj is not None:
                        self.P0 = torch.maximum(self.P0, (E.real ** 2 + E.imag ** 2).sum((1, 2)).detach())
                    Pt = (E.real ** 2 + E.imag ** 2).sum((1, 2))
                    E = E * torch.sqrt(torch.where(Pt > 1e-30, self.P0 / Pt.clamp_min(1e-30), torch.zeros_like(Pt)))[:, None, None]
                recs.append(self.cellI(E))
                I = (E.real ** 2 + E.imag ** 2).reshape(E.shape[0], -1)
                bgs.append(I[:, ~self.cellmask].max(1).values)
            return E, torch.stack(recs), torch.stack(bgs), torch.stack(dEs)

        dE = []
        for t0 in range(1, T + 1, chunk):
            t1 = min(T + 1, t0 + chunk)
            E, r, b, d = checkpoint(run_chunk, E, self.theta, self.z_amp, t0, t1, use_reentrant=False)
            cI.append(r)
            bg.append(b)
            dE.append(d)
        cI = torch.cat([cI[0][None]] + cI[1:], 0)  # (T+1, B, K)
        self.last_dE = torch.cat(dE, 0)  # (T, B)
        return cI, torch.cat(bg, 0), E

    def loss(self, cI, bg):
        P = self.P
        hi, lo = P['I_hi'], P['I_lo']
        tgt = self.tgt[:cI.shape[0]]
        m1 = tgt == 1
        m0 = tgt == 0
        l_on = torch.relu(hi - cI[m1]) ** 2
        l_off = torch.relu(cI[m0] - lo) ** 2
        l = (l_on.sum() + l_off.sum()) / max(1, int(m1.sum() + m0.sum()))
        l_bg = torch.relu(bg - P['bg_max']).pow(2).mean()
        L = l + P['w_bg'] * l_bg
        if P.get('w_stat', 0) > 0:
            # stationarity: cells and the whole field must stop changing over the last `stat_frac` of the rollout
            k0 = int(cI.shape[0] * (1 - P.get('stat_frac', 0.4)))
            l_cell = ((cI[k0 + 1:] - cI[k0:-1]) ** 2).mean()
            l_field = self.last_dE[k0:].mean()
            L = L + P['w_stat'] * (l_cell + l_field)
        return L, l.item(), l_bg.item()

    def metrics(self, cI):
        """decoded accuracy per target sample using threshold (I_hi + I_lo)/2, and margin."""
        thr = 0.5 * (self.P['I_hi'] + self.P['I_lo'])
        tgt = self.tgt[:cI.shape[0]]
        m = ~torch.isnan(tgt)
        dec = (cI > thr).float()
        acc = (dec[m] == tgt[m]).float().mean().item()
        return acc

    def train(self, iters, lr, noise, log_every=10):
        groups = [{'params': [self.theta], 'lr': lr}, {'params': [self.logG], 'lr': lr * 0.1 if self.P.get('learn_gain', True) else 0.0}]
        if self.z_amp is not None:
            groups.append({'params': [self.z_amp], 'lr': self.P.get('lr_amp', lr * 4)})
        opt = torch.optim.Adam(groups)
        hist = []
        t0 = time.time()
        best = (1e9, None, None)
        for it in range(iters):
            opt.zero_grad()
            cI, bg, _ = self.rollout(noise=noise)
            L, lt, lb = self.loss(cI, bg)
            L.backward()
            opt.step()
            with torch.no_grad():
                self.logG.clamp_(math.log(0.05), math.log(6))
            acc = self.metrics(cI.detach())
            hist.append(dict(it=it, loss=L.item(), task=lt, bg=lb, acc=acc, G0=float(1 + torch.exp(self.logG))))
            if L.item() < best[0]:
                best = (L.item(), self.theta.detach().clone(), self.logG.detach().clone(), None if self.z_amp is None else self.z_amp.detach().clone())
            if it % log_every == 0 or it == iters - 1:
                print(f"it {it} loss {L.item():.4e} task {lt:.3e} bg {lb:.3e} acc {acc:.3f} G0 {hist[-1]['G0']:.3f} [{time.time()-t0:.0f}s]", flush=True)
        with torch.no_grad():
            self.theta.copy_(best[1]); self.logG.copy_(best[2])
            if self.z_amp is not None:
                self.z_amp.copy_(best[3])
        return hist

    def save(self, tag, hist):
        base = os.path.join(OUT, tag)
        np.asarray(torch.remainder(self.theta.detach(), 2 * math.pi).numpy(), dtype=np.float64).tofile(base + '_mask.f64')
        spec = dict(self.P)
        spec.update(tag=tag, mask_file=base + '_mask.f64', G0=float(1 + torch.exp(self.logG)), arch=TWIN_ARCH[self.P['twin']], T_train=self.T, history=hist)
        if self.z_amp is not None:
            drive = (2 * math.pi * 0.999 * torch.sigmoid(self.z_amp)).detach().numpy().astype(np.float64)
            drive.tofile(base + '_amp.f64')
            spec.update(amp_file=base + '_amp.f64', amp_dark=TWIN_ARCH[self.P['twin']]['amp_dark'], amp_clear_fraction=float((drive / (2 * math.pi) > 0.5).mean()))
        spec.pop('init_mask', None)
        if 'eval_cases' in spec:
            spec['train_cases'] = spec['cases']
            spec['cases'] = spec.pop('eval_cases')
        json.dump(spec, open(base + '_spec.json', 'w'), indent=1)
        print('saved', base)


# ───────────────────────────── task builders ─────────────────────────────

BASE = dict(twin='A64s', G0=2.0, Ig=1.0, s=-0.6, Ia=0.05, kerr=0.0, I_init=1.5, I_hi=0.6, I_lo=0.08, bg_max=0.3, w_bg=0.2, inj_amp=6.0,
            iters=300, lr=0.05, noise=0.01, learn_gain=True)


def lattice_cells(nx, ny, pitch, w, n=64, prefix='m'):
    x0 = (n - (nx - 1) * pitch - w) // 2
    y0 = (n - (ny - 1) * pitch - w) // 2
    return {f'{prefix}{j}_{i}': [x0 + i * pitch, y0 + j * pitch, w] for j in range(ny) for i in range(nx)}


def task_memory(P):
    """random bit patterns on a lattice must hold (written by one pulse at t=1)."""
    cells = lattice_cells(P['side'], P['side'], P['pitch'], P['w'])
    rng = np.random.default_rng(P.get('seed', 0))
    T = P['T']
    cases = []
    for b in range(P['batch']):
        bits = rng.integers(0, 2, len(cells))
        on = [k for k, v in zip(cells, bits) if v]
        cases.append(dict(name=f'pattern{b}', init_on=[], inject=[dict(t=1, cell=k, amp=P['inj_amp'], phase=0.0) for k in on],
                          targets=[dict(cell=k, value=int(v), t_from=T // 3, t_to=T) for k, v in zip(cells, bits)]))
    return cells, cases


def gate_truth(fn, arity):
    import itertools
    return [(bits, fn(*bits)) for bits in itertools.product([0, 1], repeat=arity)]


GATES = {'NOT': (1, lambda a: 1 - a), 'AND': (2, lambda a, b: a & b), 'OR': (2, lambda a, b: a | b), 'XOR': (2, lambda a, b: a ^ b), 'NAND': (2, lambda a, b: 1 - (a & b)),
         'COPY': (1, lambda a: a)}


def task_gate(P):
    """inputs (bistable cells written at t=1) → output cell. rails: always-on cells written at t=1 in every case (power)."""
    g = P['gate']
    arity, fn = GATES[g]
    w, d = P['w'], P['dist']
    c = 32 - w // 2
    cells = {}
    ins = [f'in{i}' for i in range(arity)]
    if arity == 1:
        cells['in0'] = [c - d, c, w]
    else:
        cells['in0'] = [c - d, c - d // 2, w]
        cells['in1'] = [c - d, c + d // 2, w]
    cells['out'] = [c + d - (d // 2 if P.get('short', False) else 0), c, w]
    rails = [f'rail{i}' for i in range(P.get('rails', 0))]
    for i, r in enumerate(rails):
        cells[r] = [c + (i - (len(rails) - 1) / 2).__int__() * (w + 2), c + d, w] if P.get('rail_side', 'below') == 'below' else [c, c - d - w, w]
    T = P['T']
    cases = []
    for bits, y in gate_truth(fn, arity):
        inj = [dict(t=1, cell=ins[i], amp=P['inj_amp'], phase=0.0) for i in range(arity) if bits[i]] + [dict(t=1, cell=r, amp=P['inj_amp'], phase=0.0) for r in rails]
        tg = [dict(cell='out', value=int(y), t_from=P['settle'], t_to=T)]
        if P.get('preserve_inputs', True):
            tg += [dict(cell=ins[i], value=int(bits[i]), t_from=P['settle'], t_to=T) for i in range(arity)]
        tg += [dict(cell=r, value=1, t_from=P['settle'], t_to=T) for r in rails] if P.get('preserve_rails', False) else []
        cases.append(dict(name=f"{g}{''.join(map(str, bits))}", init_on=[], inject=inj, targets=tg))
    return cells, cases


def task_wire(P):
    """copy a bit from src to dst at distance dist (pixels, along x); optional spectator cells must keep their bits."""
    w, d = P['w'], P['dist']
    c = 32 - w // 2
    cells = {'src': [c - d // 2, c, w], 'dst': [c - d // 2 + d, c, w]}
    for i in range(P.get('spectators', 0)):
        cells[f'spec{i}'] = [c - d // 2 + (i + 1) * d // (P['spectators'] + 1), c + P.get('spec_offset', 6), w]
    T = P['T']
    rng = np.random.default_rng(1)
    cases = []
    for sb in (0, 1):
        for rep in range(P.get('reps', 2)):
            specbits = {k: int(rng.integers(0, 2)) for k in cells if k.startswith('spec')}
            inj = ([dict(t=1, cell='src', amp=P['inj_amp'], phase=0.0)] if sb else []) + [dict(t=1, cell=k, amp=P['inj_amp'], phase=0.0) for k, v in specbits.items() if v]
            tg = [dict(cell='dst', value=sb, t_from=P['settle'], t_to=T), dict(cell='src', value=sb, t_from=P['settle'], t_to=T)] + [dict(cell=k, value=v, t_from=P['settle'], t_to=T) for k, v in specbits.items()]
            cases.append(dict(name=f'src{sb}_{rep}', init_on=[], inject=inj, targets=tg))
    return cells, cases


def task_latch(P):
    """Q with set (S) and reset (R) injection regions. Pulses at t_p; Q must follow and then hold."""
    w, d = P['w'], P['dist']
    c = 32 - w // 2
    cells = {'Q': [c, c, w], 'S': [c - d, c, w], 'R': [c + d, c, w]}
    for i in range(P.get('rails', 0)):
        cells[f'rail{i}'] = [c, c + d + i * (w + 2), w]
    rails = [k for k in cells if k.startswith('rail')]
    T, tp, st = P['T'], P['t_pulse'], P['settle']
    A, ph_r = P['inj_amp'], P.get('reset_phase', math.pi)
    railinj = [dict(t=1, cell=r, amp=A, phase=0.0) for r in rails]
    q1 = [dict(t=1, cell='Q', amp=A, phase=0.0)]
    S = lambda t: [dict(t=t, cell='S', amp=A * P.get('s_amp', 1.0), phase=0.0)]
    R = lambda t: [dict(t=t, cell='R', amp=A * P.get('r_amp', 1.0), phase=ph_r)]
    t2 = tp + P.get('gap', 60)
    cases = [
        dict(name='hold0', inject=railinj, targets=[dict(cell='Q', value=0, t_from=st, t_to=T)]),
        dict(name='hold1', inject=railinj + q1, targets=[dict(cell='Q', value=1, t_from=st, t_to=T)]),
        dict(name='set_from0', inject=railinj + S(tp), targets=[dict(cell='Q', value=0, t_from=st, t_to=tp - 1), dict(cell='Q', value=1, t_from=tp + st, t_to=T)]),
        dict(name='set_from1', inject=railinj + q1 + S(tp), targets=[dict(cell='Q', value=1, t_from=st, t_to=T)]),
        dict(name='reset_from1', inject=railinj + q1 + R(tp), targets=[dict(cell='Q', value=1, t_from=st, t_to=tp - 1), dict(cell='Q', value=0, t_from=tp + st, t_to=T)]),
        dict(name='reset_from0', inject=railinj + R(tp), targets=[dict(cell='Q', value=0, t_from=st, t_to=T)]),
        dict(name='set_then_reset', inject=railinj + S(tp) + R(t2), targets=[dict(cell='Q', value=1, t_from=tp + st, t_to=t2 - 1), dict(cell='Q', value=0, t_from=t2 + st, t_to=T)]),
        dict(name='reset_then_set', inject=railinj + q1 + R(tp) + S(t2), targets=[dict(cell='Q', value=0, t_from=tp + st, t_to=t2 - 1), dict(cell='Q', value=1, t_from=t2 + st, t_to=T)]),
    ]
    for c_ in cases:
        c_.setdefault('init_on', [])
        if P.get('preserve_rails', False):
            c_['targets'] += [dict(cell=r, value=1, t_from=st, t_to=T) for r in rails]
    return cells, cases


def task_ring(P):
    """one-hot ring counter over N cells: token written into cell 0 at t=1 must advance one cell every `period` trips."""
    N, w, R = P['N'], P['w'], P['radius']
    cells = {}
    for i in range(N):
        a = 2 * math.pi * i / N
        cells[f'c{i}'] = [int(round(32 + R * math.cos(a) - w / 2)), int(round(32 + R * math.sin(a) - w / 2)), w]
    T, per, st = P['T'], P['period'], P['settle']
    cases = []
    starts = P.get('starts', [0])
    for s0 in starts:
        tg = []
        for t in range(1, T + 1):
            k = (s0 + (t - 1) // per) % N
            ph = (t - 1) % per
            if ph < st:  # allow transition time at the start of each tick
                continue
            tg += [dict(cell=f'c{i}', value=int(i == k), t_from=t, t_to=t) for i in range(N)]
        cases.append(dict(name=f'start{s0}', init_on=[], inject=[dict(t=1, cell=f'c{s0}', amp=P['inj_amp'], phase=0.0)], targets=tg))
    return cells, cases


def task_toggle(P):
    """two-state autonomous oscillator: cells A and B alternate every `period` trips after a single start pulse into A."""
    return task_ring(dict(P, N=2))


def task_adder(P):
    """direct whole-circuit optimisation: half/full/ripple adder, inputs written at t=1, outputs must settle and hold."""
    import itertools
    nbits, full = P['nbits'], P.get('full', False)
    w, pitch = P['w'], P['pitch']
    cells = {}
    rows = nbits
    for i in range(nbits):
        cells[f'a{i}'] = [6, 10 + i * pitch * 2, w]
        cells[f'b{i}'] = [6, 10 + i * pitch * 2 + pitch, w]
        cells[f's{i}'] = [64 - 6 - w, 10 + i * pitch * 2, w]
    cells['cout'] = [64 - 6 - w, 10 + nbits * pitch * 2, w]
    if full:
        cells['cin'] = [6, 10 + nbits * pitch * 2, w]
    rails = [f'rail{i}' for i in range(P.get('rails', 0))]
    for i, r in enumerate(rails):
        cells[r] = [20 + i * (w + 3), 58 - w, w]
    T, st = P['T'], P['settle']
    cases = []
    combos = list(itertools.product([0, 1], repeat=2 * nbits + (1 if full else 0)))
    if len(combos) > P.get('max_cases', 64):
        rng = np.random.default_rng(3)
        combos = [combos[i] for i in rng.choice(len(combos), P['max_cases'], replace=False)]
    for bits in combos:
        a = sum(bits[i] << i for i in range(nbits))
        b = sum(bits[nbits + i] << i for i in range(nbits))
        cin = bits[-1] if full else 0
        ssum = a + b + cin
        inj = [dict(t=1, cell=f'a{i}', amp=P['inj_amp'], phase=0.0) for i in range(nbits) if (a >> i) & 1]
        inj += [dict(t=1, cell=f'b{i}', amp=P['inj_amp'], phase=0.0) for i in range(nbits) if (b >> i) & 1]
        if full and cin:
            inj.append(dict(t=1, cell='cin', amp=P['inj_amp'], phase=0.0))
        inj += [dict(t=1, cell=r, amp=P['inj_amp'], phase=0.0) for r in rails]
        tg = [dict(cell=f's{i}', value=(ssum >> i) & 1, t_from=st, t_to=T) for i in range(nbits)] + [dict(cell='cout', value=(ssum >> nbits) & 1, t_from=st, t_to=T)]
        if P.get('preserve_inputs', True):
            tg += [dict(cell=f'a{i}', value=(a >> i) & 1, t_from=st, t_to=T) for i in range(nbits)] + [dict(cell=f'b{i}', value=(b >> i) & 1, t_from=st, t_to=T) for i in range(nbits)]
        cases.append(dict(name=f'a{a}b{b}c{cin}', init_on=[], inject=inj, targets=tg))
    return cells, cases


TASKS = dict(memory=task_memory, gate=task_gate, wire=task_wire, latch=task_latch, ring=task_ring, toggle=task_toggle, adder=task_adder)


PATTERNS = {
    'circle': ["..####..", ".#....#.", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####.."],
    'cross': ["#......#", ".#....#.", "..#..#..", "...##...", "...##...", "..#..#..", ".#....#.", "#......#"],
    'smile': ["..####..", ".#....#.", "#.#..#.#", "#......#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
    'rand1': None, 'rand2': None,
}


def task_assoc(P):
    """stored patterns (8×8 cells) as attractors: corrupted cue written at t=1 must relax to the stored pattern."""
    side, pitch, w = 8, P['pitch'], P['w']
    cells = lattice_cells(side, side, pitch, w)
    names = list(cells)
    rng = np.random.default_rng(P.get('seed', 5))
    pats = {}
    for k in P['patterns']:
        if PATTERNS.get(k):
            pats[k] = np.array([[1 if ch == '#' else 0 for ch in row] for row in PATTERNS[k]]).ravel()
        else:
            pats[k] = (rng.random(side * side) < 0.4).astype(int)
    T, st = P['T'], P['settle']
    cases = []
    for k, p in pats.items():
        for flip in P['train_flips']:
            for rep in range(P['reps']):
                q = p.copy()
                idx = rng.choice(len(q), flip, replace=False)
                q[idx] = 1 - q[idx]
                cases.append(dict(name=f'{k}_flip{flip}_{rep}', init_on=[], inject=[dict(t=1, cell=names[i], amp=P['inj_amp'], phase=0.0) for i in range(len(q)) if q[i]],
                                  targets=[dict(cell=names[i], value=int(p[i]), t_from=st, t_to=T) for i in range(len(p))], pattern=k, flips=flip, cue=q.tolist()))
    P['stored'] = {k: v.tolist() for k, v in pats.items()}
    return cells, cases


TASKS['assoc'] = task_assoc


def _bits(v, n):
    return [(v >> i) & 1 for i in range(n)]


BOOLFNS = {
    # name: (n_in, n_out, fn(list of input bits) -> list of output bits)
    'halfadd': (2, 2, lambda x: [x[0] ^ x[1], x[0] & x[1]]),
    'fulladd': (3, 2, lambda x: [x[0] ^ x[1] ^ x[2], (x[0] & x[1]) | (x[2] & (x[0] ^ x[1]))]),
    'add2': (4, 3, lambda x: _bits((x[0] + 2 * x[1]) + (x[2] + 2 * x[3]), 3)),
    'parity4': (4, 1, lambda x: [sum(x) % 2]),
    'parity8': (8, 1, lambda x: [sum(x) % 2]),
    # reduced saturating controller: inputs (e_pos, e_neg, acc0, acc1) -> acc' (2 bits), saturating at 0 and 3
    'satstep2': (4, 2, lambda x: _bits(min(3, x[2] + 2 * x[3] + 1) if (x[0] and not x[1]) else (max(0, x[2] + 2 * x[3] - 1) if (x[1] and not x[0]) else x[2] + 2 * x[3]), 2)),
}


def task_boolfn(P):
    """direct static spatial compilation of a truth table: input bits written at t=1, outputs must settle by `settle` and hold to T."""
    import itertools
    n_in, n_out, fn = BOOLFNS[P['fn']]
    w, gap = P['w'], P.get('gap', 2)
    step = w + gap
    x_in, x_out = P.get('x_in', 12), P.get('x_out', 49)
    y0 = lambda n: 32 - (n * step - gap) // 2
    cells = {f'i{k}': [x_in, y0(n_in) + k * step, w] for k in range(n_in)}
    cells.update({f'o{k}': [x_out, y0(n_out) + k * step, w] for k in range(n_out)})
    rails = [f'rail{k}' for k in range(P.get('rails', 0))]
    for k, r in enumerate(rails):
        cells[r] = [P.get('rail_x', 30) + k * step, P.get('rail_y', 6), w]
    combos = list(itertools.product([0, 1], repeat=n_in))
    def case(bits):
        y = fn(list(bits))
        inj = [dict(t=1, cell=f'i{k}', amp=P['inj_amp'], phase=0.0) for k in range(n_in) if bits[k]] + [dict(t=1, cell=r, amp=P['inj_amp'], phase=0.0) for r in rails]
        tg = [dict(cell=f'o{k}', value=int(y[k]), t_from=P['settle'], t_to=P['T']) for k in range(n_out)]
        if P.get('preserve_inputs', False):
            tg += [dict(cell=f'i{k}', value=int(bits[k]), t_from=P['settle'], t_to=P['T']) for k in range(n_in)]
        return dict(name=P['fn'] + ''.join(map(str, bits)), init_on=[], inject=inj, targets=tg)
    all_cases = [case(b) for b in combos]
    if len(all_cases) > P.get('max_cases', 64):
        rng = np.random.default_rng(11)
        train = [all_cases[i] for i in rng.choice(len(all_cases), P['max_cases'], replace=False)]
        P['eval_cases'] = all_cases
        return cells, train
    return cells, all_cases


TASKS['boolfn'] = task_boolfn


def task_countdown(P):
    """program `x = n; while (x != 0) x--; halt` compiled into a static spatial transition graph:
    a one-hot token written into cell n at t=1 must step to cell n-1 every `period` trips and stop (halt) in cell 0."""
    N, w, gap = P['N'], P['w'], P.get('gap', 3)
    step = w + gap
    x0 = 32 - (N * step + w) // 2
    cells = {f'c{k}': [x0 + k * step, 32 - w // 2, w] for k in range(N + 1)}
    T, per, st = P['T'], P['period'], P['settle']
    cases = []
    for n in P.get('starts', list(range(1, N + 1))):
        tg = []
        for t in range(1, T + 1):
            k = max(0, n - (t - 1) // per)
            if (t - 1) % per < st and k > 0:
                continue  # transition time inside each tick
            tg += [dict(cell=f'c{i}', value=int(i == k), t_from=t, t_to=t) for i in range(N + 1)]
        cases.append(dict(name=f'n{n}', init_on=[], inject=[dict(t=1, cell=f'c{n}', amp=P['inj_amp'], phase=0.0)], targets=tg))
    return cells, cases


TASKS['countdown'] = task_countdown

if __name__ == '__main__':
    task = sys.argv[1]
    P = dict(BASE)
    P.update(json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    cells, cases = TASKS[task](P)
    P.update(task=task, cells=cells, cases=cases)
    tag = P.get('tag', task)
    prob = Problem(P)
    print(f'{tag}: {len(cells)} cells, {len(cases)} cases, T={prob.T}, twin {P["twin"]}', flush=True)
    for stage in P.get('curriculum', [None]):
        if stage:
            prob.P.update(stage)
        hist = prob.train(P['iters'] if not stage else stage.get('iters', P['iters']), P['lr'], P['noise'])
    prob.save(tag, hist)
