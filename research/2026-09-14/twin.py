"""Differentiable torch replica of a dumped phaser route (twin-dump.ts). Arrays come from the live JS simulator; only the
programmable device phase law, the saturable/Kerr formulas and the gain law are re-expressed (and validated against a
JS trajectory in `validate`). Used ONLY to design static masks; every result is re-evaluated in the JS simulator.
"""
import json, math, os, sys
import numpy as np
import torch

BIG = '/private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/big/'
torch.set_default_dtype(torch.float64)


def _c(path, n):
    a = np.fromfile(path, dtype=np.complex128)
    return torch.from_numpy(a.reshape(n, n).copy())


class Twin:
    def __init__(self, name, device='cpu'):
        d = BIG + f'twin_{name}/'
        self.meta = json.load(open(d + 'twin.json'))
        g = self.meta['grid']
        self.n = g['nx']
        self.dx = g['dx']
        self.t_rt = self.meta['roundTripTime']
        n = self.n
        self.ops = []
        cache = {}
        for op in self.meta['ops']:
            o = dict(op)
            if op['op'] == 'prop':
                o['H'] = cache.setdefault(op['kernel'], _c(d + op['kernel'], n))
                o['W'] = None if op['boundary'] is None else cache.setdefault(op['boundary'], _c(d + op['boundary'], n).real)
            elif op['op'] == 'mul':
                o['T'] = _c(d + op['t'], n)
            elif op['op'] == 'pixelamp':
                m = np.fromfile(d + op['map'], dtype=np.float64).astype(np.int64).reshape(n, n)
                o['map'] = torch.from_numpy(np.maximum(m, 0))
                o['active'] = torch.from_numpy(m >= 0)
                o['inactive_amp'] = torch.from_numpy(np.where(m == -2, op['deadAmp'], op['outsideAmp']).astype(np.float64))
            elif op['op'] == 'pixelphase':
                m = np.fromfile(d + op['map'], dtype=np.float64).astype(np.int64).reshape(n, n)
                o['map'] = torch.from_numpy(np.maximum(m, 0))
                amp = np.where(m >= 0, op['amp'], np.where(m == -2, op['deadAmp'], op['outsideAmp']))
                o['ampmap'] = torch.from_numpy(amp.astype(np.float64)) * op['scale']
                o['active'] = torch.from_numpy(m >= 0)
            self.ops.append(o)
        self.devices = sorted({o['device'] for o in self.ops if o['op'] in ('pixelphase', 'pixelamp')})
        self.res = {o['device']: (o['resY'], o['resX']) for o in self.ops if o['op'] in ('pixelphase', 'pixelamp')}

    quantize = False

    def achieved(self, o, cmd):
        """commanded phase (rad, per pixel) → achieved phase, as pixels.ts achievedPhase (quantisation: straight-through)."""
        TAU = 2 * math.pi
        u = torch.remainder(cmd, TAU) / o['phaseRange']
        u = torch.clamp(u, 0, 1)
        if self.quantize and o['levels'] >= 2:
            q = torch.round(u * (o['levels'] - 1)) / (o['levels'] - 1)
            u = u + (q - u).detach()
        r = o['response']
        if r['kind'] == 'gamma':
            u = torch.clamp(u, 1e-12, 1) ** r['gamma']
        elif r['kind'] == 'lut':
            raise NotImplementedError
        return u * o['phaseRange'] * o['lambdaScale']

    def trip(self, E, masks, inject=None, noise=None):
        """E: (B, n, n) complex. masks: {device: (resY, resX) commanded phase}. inject: (B, n, n) or None."""
        for o in self.ops:
            k = o['op']
            if k == 'prop':
                E = torch.fft.ifft2(torch.fft.fft2(E) * o['H'])
                if o['W'] is not None:
                    E = E * o['W']
            elif k == 'scale':
                E = E * o['a']
            elif k == 'flip-x':
                E = torch.flip(E, dims=[-1])
            elif k == 'flip-y':
                E = torch.flip(E, dims=[-2])
            elif k == 'mul':
                E = E * o['T']
            elif k == 'inject':
                if inject is not None:
                    E = E + o['coupling'] * inject
            elif k == 'pixelphase':
                cmd = masks.get(o['device'])
                ph = self.achieved(o, cmd.reshape(-1))[o['map']] if cmd is not None else torch.zeros(self.n, self.n)
                ph = torch.where(o['active'], ph, torch.zeros_like(ph))
                E = E * (o['ampmap'] * torch.exp(1j * ph))
            elif k == 'pixelamp':
                cmd = masks.get(o['device'])
                TAU = 2 * math.pi
                if cmd is None:
                    u = torch.zeros(self.n, self.n)
                else:
                    uu = torch.remainder(cmd.reshape(-1), TAU) / TAU
                    if self.quantize and o['levels'] >= 2:
                        q = torch.round(uu * (o['levels'] - 1)) / (o['levels'] - 1)
                        uu = uu + (q - uu).detach()
                    u = uu[o['map']]
                T = o['dark'] + (o['clear'] - o['dark']) * u
                a = torch.where(o['active'], torch.sqrt(torch.clamp(T, min=0)), o['inactive_amp'])
                E = E * (a * o['scale'])
            elif k == 'nonlinear':
                I = E.real ** 2 + E.imag ** 2
                a = o['amplitude']
                g = 1 + a['strength'] / (1 + I / a['saturationIntensity']) if a['kind'] == 'saturable' else torch.ones_like(I)
                p = o['phase']
                ph = p['coefficient'] * I if p['kind'] == 'kerr' else (p['maxPhase'] * I / (I + p['saturationIntensity']) if p['kind'] == 'saturable-kerr' else torch.zeros_like(I))
                E = E * torch.sqrt(torch.clamp(g, min=0)) * torch.exp(1j * ph)
            elif k == 'gain':
                sat = o['saturation']
                I = E.real ** 2 + E.imag ** 2
                if sat['kind'] == 'local':
                    g = 1 + (o['G0'] - 1) / (1 + I / sat['saturationIntensity'])
                elif sat['kind'] == 'global':
                    g = 1 + (o['G0'] - 1) / (1 + I.mean(dim=(-2, -1), keepdim=True) / sat['saturationIntensity'])
                else:
                    g = torch.full_like(I, o['G0'])
                E = E * torch.sqrt(torch.clamp(g, min=0))
                if noise is not None:
                    E = E + noise
        return E

    def set_active(self, gain=None, nl=None):
        """override gain/nonlinear parameters (dicts shaped like the JSON specs)."""
        for o in self.ops:
            if o['op'] == 'gain' and gain:
                o.update(gain)
            if o['op'] == 'nonlinear' and nl:
                o.update(nl)

    def coords(self):
        x = (np.arange(self.n) - self.n / 2 + 0.5) * self.dx
        return np.meshgrid(x, x)


def validate(name):
    tw = Twin(name)
    tw.quantize = True
    d = BIG + f'twin_{name}/'
    n = tw.n
    masks = {}
    rng_mask = None
    for pr in tw.meta['programmable']:
        p = pr['program']
        if p['kind'] == 'random':
            # mulberry32 replica for the random program
            a = p['seed'] & 0xFFFFFFFF
            ry, rx = tw.res[pr['id']]
            vals = []
            for _ in range(rx * ry):
                a = (a + 0x6D2B79F5) & 0xFFFFFFFF
                t = a
                t = (((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF)
                t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
                vals.append(((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296)
            masks[pr['id']] = torch.tensor(vals).reshape(ry, rx) * 2 * math.pi * p['depth']
    E = _c(d + 'traj0.c128', n)[None]
    inj = _c(d + 'inject.c128', n)[None]
    worst = 0
    for t in range(1, 7):
        E = tw.trip(E, masks, inject=inj if t == 2 else None)
        ref = _c(d + f'traj{t}.c128', n)
        err = (torch.linalg.norm(E[0] - ref) / torch.linalg.norm(ref)).item()
        worst = max(worst, err)
        print(f'{name} trip {t}: relative error vs JS {err:.2e}')
    return worst


if __name__ == '__main__':
    for nm in sys.argv[1:]:
        validate(nm)
