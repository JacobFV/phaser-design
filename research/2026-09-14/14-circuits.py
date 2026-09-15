"""Experiment 14 (+11/12/13 bookkeeping): gate-level netlists of the three C kernels and of a tiny accumulator machine, so the
optical cost measured for a single gate / register / wire (Exps. 7–9) can be turned into area and recurrence estimates for
(a) direct static spatial compilation of the function and (b) execution on a sequential optical machine.

Netlists are generated and SIMULATED here (digital evaluation of the netlist only; this is bookkeeping, not an optical result)
and checked exhaustively against the native C reference tables in out/13.
"""
import csv, itertools, json, os
from collections import defaultdict

OUT = os.path.join(os.path.dirname(__file__), 'out', '14')
os.makedirs(OUT, exist_ok=True)
REF = os.path.join(os.path.dirname(__file__), 'out', '13')


class Net:
    def __init__(self, name):
        self.name, self.gates, self.inputs, self.outputs = name, [], [], []
        self.n = 0

    def inp(self, label):
        w = f'{label}'
        self.inputs.append(w)
        return w

    def g(self, op, *args):
        self.n += 1
        w = f'w{self.n}'
        self.gates.append((w, op, args))
        return w

    def AND(self, a, b): return self.g('AND', a, b)
    def OR(self, a, b): return self.g('OR', a, b)
    def XOR(self, a, b): return self.g('XOR', a, b)
    def NOT(self, a): return self.g('NOT', a)
    def CONST(self, v): return self.g('C1' if v else 'C0')

    def eval(self, assign):
        v = dict(assign)
        for w, op, a in self.gates:
            if op == 'AND': v[w] = v[a[0]] & v[a[1]]
            elif op == 'OR': v[w] = v[a[0]] | v[a[1]]
            elif op == 'XOR': v[w] = v[a[0]] ^ v[a[1]]
            elif op == 'NOT': v[w] = 1 - v[a[0]]
            elif op == 'C1': v[w] = 1
            elif op == 'C0': v[w] = 0
        return v

    def stats(self):
        depth = defaultdict(int)
        for w in self.inputs:
            depth[w] = 0
        for w, op, a in self.gates:
            depth[w] = 1 + max((depth[x] for x in a), default=0)
        counts = defaultdict(int)
        for _, op, _ in self.gates:
            counts[op] += 1
        return dict(gates=sum(v for k, v in counts.items() if k not in ('C0', 'C1')), by_type=dict(counts), depth=max((depth[o] for o in self.outputs), default=0),
                    inputs=len(self.inputs), outputs=len(self.outputs), wires=len(self.gates) + len(self.inputs))


def full_adder(N, a, b, c):
    s1 = N.XOR(a, b)
    return N.XOR(s1, c), N.OR(N.AND(a, b), N.AND(s1, c))


def ripple_add(N, A, B, cin):
    S, c = [], cin
    for a, b in zip(A, B):
        s, c = full_adder(N, a, b, c)
        S.append(s)
    return S, c


def build_parity():
    N = Net('parity8')
    x = [N.inp(f'x{i}') for i in range(8)]
    # literal lowering of the C: x ^= x>>4; x ^= x>>2; x ^= x>>1; return x&1  (keep only the bits that reach bit 0)
    y = [N.XOR(x[i], x[i + 4]) if i + 4 < 8 else x[i] for i in range(8)]
    z = [N.XOR(y[i], y[i + 2]) if i + 2 < 8 else y[i] for i in range(8)]
    out = N.XOR(z[0], z[1])
    N.outputs = [out]
    return N


def build_step():
    """uint8_t step(int8_t error, uint8_t acc): error sign bits + zero test, acc==255 / acc==0 tests, ±1 adder."""
    N = Net('sat_step8')
    e = [N.inp(f'e{i}') for i in range(8)]
    a = [N.inp(f'a{i}') for i in range(8)]
    neg = e[7]
    nz = e[0]
    for i in range(1, 8):
        nz = N.OR(nz, e[i])
    pos = N.AND(nz, N.NOT(neg))
    all1 = a[0]
    any1 = a[0]
    for i in range(1, 8):
        all1 = N.AND(all1, a[i]); any1 = N.OR(any1, a[i])
    inc = N.AND(pos, N.NOT(all1))
    dec = N.AND(neg, any1)
    # acc + (inc ? +1 : dec ? −1 : 0): add B = dec repeated (two's complement −1 = 0xFF) with carry-in inc
    B = [dec] * 8
    S, _ = ripple_add(N, a, B, inc)
    N.outputs = S
    return N


def build_gcd_iteration():
    """one iteration of the modulo-free Euclid datapath for 8-bit (a, b) with b ≠ 0: if a > b then a −= b else b −= a; plus done = (b == 0)."""
    N = Net('gcd8_sub_iteration')
    a = [N.inp(f'a{i}') for i in range(8)]
    b = [N.inp(f'b{i}') for i in range(8)]
    one = N.CONST(1)
    nb = [N.NOT(x) for x in b]
    na = [N.NOT(x) for x in a]
    amb, c1 = ripple_add(N, a, nb, one)   # a − b ; carry out = (a ≥ b)
    bma, _ = ripple_add(N, b, na, one)    # b − a
    eq = one
    for i in range(8):
        eq = N.AND(eq, N.NOT(N.XOR(a[i], b[i])))
    gt = N.AND(c1, N.NOT(eq))
    na_out = [N.OR(N.AND(gt, amb[i]), N.AND(N.NOT(gt), a[i])) for i in range(8)]
    nb_out = [N.OR(N.AND(gt, b[i]), N.AND(N.NOT(gt), bma[i])) for i in range(8)]
    bz = one
    for i in range(8):
        bz = N.AND(bz, N.NOT(nb_out[i]))
    N.outputs = na_out + nb_out + [bz]
    return N


def check_parity(N):
    ref = {int(r['x']): int(r['out']) for r in csv.DictReader(open(os.path.join(REF, 'ref_parity.csv')))}
    ok = 0
    for x in range(256):
        v = N.eval({f'x{i}': (x >> i) & 1 for i in range(8)})
        ok += v[N.outputs[0]] == ref[x]
    return ok, 256


def check_step(N):
    ok = tot = 0
    for r in csv.DictReader(open(os.path.join(REF, 'ref_step.csv'))):
        e = int(r['error']) & 0xFF; a = int(r['acc'])
        v = N.eval({**{f'e{i}': (e >> i) & 1 for i in range(8)}, **{f'a{i}': (a >> i) & 1 for i in range(8)}})
        out = sum(v[w] << i for i, w in enumerate(N.outputs))
        ok += out == int(r['out']); tot += 1
    return ok, tot


def check_gcd(N):
    ok = tot = 0
    iters_hist = []
    import random
    rows = list(csv.DictReader(open(os.path.join(REF, 'ref_gcd8.csv'))))
    rnd = random.Random(7)
    sample = [r for r in rows if int(r['a']) < 48 and int(r['b']) < 48] + rnd.sample(rows, 4000)  # exhaustive over 48×48 + random 4000
    for r in sample:
        a, b = int(r['a']), int(r['b'])
        if a == 0:
            res, it = b, 0
        else:
            it = 0
            while b != 0 and it < 300:
                v = N.eval({**{f'a{i}': (a >> i) & 1 for i in range(8)}, **{f'b{i}': (b >> i) & 1 for i in range(8)}})
                a = sum(v[N.outputs[i]] << i for i in range(8)); b = sum(v[N.outputs[8 + i]] << i for i in range(8))
                it += 1
            res = a
        ok += res == int(r['out']); tot += 1; iters_hist.append(it)
    return ok, tot, max(iters_hist), sum(iters_hist) / len(iters_hist)


# ── tiny accumulator ISA: LDI imm, LOAD a, STORE a, ADD a, XOR a, DEC, JNZ a, HALT; 4-bit data, 4-bit PC, 4 RAM cells ──
ISA = dict(opcode_bits=3, data_bits=4, addr_bits=2, pc_bits=4, ram_cells=4, program_words=16)


def isa_cost():
    """gate-count estimate of the control+datapath of the accumulator machine (one instruction per clock tick)."""
    d = ISA['data_bits']
    N = Net('accumulator_step')
    acc = [N.inp(f'acc{i}') for i in range(d)]
    ram = [[N.inp(f'r{k}_{i}') for i in range(d)] for k in range(ISA['ram_cells'])]
    pc = [N.inp(f'pc{i}') for i in range(ISA['pc_bits'])]
    word = [N.inp(f'w{i}') for i in range(ISA['opcode_bits'] + d)]  # fetched instruction (ROM lookup counted separately)
    op = word[:3]; imm = word[3:]; addr = imm[:2]
    # address decode 2→4
    ad = [N.AND(N.AND(addr[0] if k & 1 else N.NOT(addr[0]), addr[1] if k & 2 else N.NOT(addr[1])), N.CONST(1)) for k in range(4)]
    mem = [N.OR(N.OR(N.AND(ad[0], ram[0][i]), N.AND(ad[1], ram[1][i])), N.OR(N.AND(ad[2], ram[2][i]), N.AND(ad[3], ram[3][i]))) for i in range(d)]
    s_add, _ = ripple_add(N, acc, mem, N.CONST(0))
    s_dec, _ = ripple_add(N, acc, [N.CONST(1)] * d, N.CONST(0))
    s_xor = [N.XOR(acc[i], mem[i]) for i in range(d)]
    opd = [N.AND(N.AND(op[0] if k & 1 else N.NOT(op[0]), op[1] if k & 2 else N.NOT(op[1])), op[2] if k & 4 else N.NOT(op[2])) for k in range(8)]
    new_acc = [N.OR(N.OR(N.AND(opd[0], imm[i]), N.AND(opd[1], mem[i])), N.OR(N.OR(N.AND(opd[3], s_add[i]), N.AND(opd[4], s_xor[i])), N.OR(N.AND(opd[5], s_dec[i]), N.AND(N.OR(N.OR(opd[2], opd[6]), opd[7]), acc[i])))) for i in range(d)]
    nz = N.OR(N.OR(acc[0], acc[1]), N.OR(acc[2], acc[3]))
    pc1, _ = ripple_add(N, pc, [N.CONST(0)] * 4, N.CONST(1))
    jump = N.AND(opd[6], nz)
    halt = opd[7]
    new_pc = [N.OR(N.AND(jump, imm[i]), N.AND(N.NOT(jump), N.OR(N.AND(halt, pc[i]), N.AND(N.NOT(halt), pc1[i])))) for i in range(4)]
    new_ram = [[N.OR(N.AND(N.AND(opd[2], ad[k]), acc[i]), N.AND(N.NOT(N.AND(opd[2], ad[k])), ram[k][i])) for i in range(d)] for k in range(4)]
    rom = 16 * (3 + d) * 2  # 16-word ROM as a 4→16 decoder + OR planes (≈ 2 gates per programmed bit)
    N.outputs = new_acc + new_pc + sum(new_ram, [])
    st = N.stats()
    st.update(rom_gates_estimate=rom, state_bits=d + 4 + 4 * d + 1, instruction_bits=3 + d)
    return st


if __name__ == '__main__':
    res = {}
    P = build_parity(); res['parity8'] = dict(P.stats(), exhaustive=check_parity(P))
    S = build_step(); res['sat_step8'] = dict(S.stats(), exhaustive=check_step(S))
    G = build_gcd_iteration(); ok, tot, mx, mean = check_gcd(G)
    res['gcd8_sub_iteration'] = dict(G.stats(), exhaustive=(ok, tot), iterations_max=mx, iterations_mean=mean)
    res['accumulator_machine_step'] = isa_cost()
    # sequential machine programs for the three kernels (instruction counts)
    res['programs'] = {
        'parity8_on_accumulator': dict(note='bitwise loop over 8 bits needs shift; the 8-op ISA has no shift → 8 LOAD/XOR pairs over pre-split bit cells', instructions_executed=2 * 8 + 1, ram_cells_needed=9),
        'sat_step_on_accumulator': dict(note='compare-and-branch on sign and saturation, then ADD/DEC', instructions_executed_worst=9),
        'gcd8_on_accumulator': dict(note='repeated subtraction with 4-bit data cannot hold 8-bit values; needs an 8-bit datapath and SUB (≈ DEC+ADD sequence)', instructions_per_iteration=8, iterations_worst=255),
    }
    json.dump(res, open(os.path.join(OUT, 'circuits.json'), 'w'), indent=1)
    for k, v in res.items():
        print(k, v)
