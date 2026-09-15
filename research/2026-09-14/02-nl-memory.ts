// Experiment 2 (nonlinear): persistent bistable bits in the self-imaging SLM ring (10 mm propagation steps, no FFT wrap).
// Static program: "moat" (π checkerboard outside cells) or none. Local saturable gain + saturable absorber.
// For each operating point: 3 random patterns written by one pulse; BER / false activation / levels at log checkpoints;
// if the pattern is intact at the end, a perturbation-growth (Benettin) test around the reached state.
// usage: npx vite-node 02-nl-memory.ts <mask moat|none> <cellPx> <pitchPx,...> <G0,...> <s:Ia,...> <T> [tag]
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { cloneField, createField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { mulberry32 } from '../../src/core/common/random'
import { slmRing } from './arch'
import { OUT, writeCsv, writeF64 } from './util'

const NOIN: RunContext = { cycle: 0, inputs: { take: () => null }, taps: { record: () => {} } }

export function latticeFor(cellPx: number, pitchPx: number, fovPx = 40, res = 64) {
  const cells = Math.floor((fovPx - cellPx) / pitchPx) + 1
  const span = (cells - 1) * pitchPx + cellPx
  const off = Math.floor((res - span) / 2)
  const idx: number[][] = []
  const inCell = new Uint8Array(res * res)
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    const a: number[] = []
    for (let dy = 0; dy < cellPx; dy++) for (let dx = 0; dx < cellPx; dx++) { const k = (off + cy * pitchPx + dy) * res + off + cx * pitchPx + dx; a.push(k); inCell[k] = 1 }
    idx.push(a)
  }
  return { cells, idx, inCell }
}

export function moat(store: AssetStore, inCell: Uint8Array, res = 64) {
  const data = new Float64Array(res * res)
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) data[y * res + x] = inCell[y * res + x] ? 0 : ((x + y) % 2) * Math.PI
  return { kind: 'array' as const, ref: store.put(`moat_${Math.random()}`, res, res, data) }
}

const cellI = (f: Field, idx: number[][]) => idx.map((a) => a.reduce((s, i) => s + f.re[i] ** 2 + f.im[i] ** 2, 0) / a.length)

function run(mask: string, cellPx: number, pitchPx: number, G0: number, s: number, Ia: number, T: number, seed: number) {
  const store = new AssetStore()
  const L = latticeFor(cellPx, pitchPx)
  const cfg = slmRing({
    n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3,
    gain: { G0, sat: { kind: 'local', saturationIntensity: 1 } },
    nl: { amplitude: { kind: 'saturable', strength: s, saturationIntensity: Ia }, phase: { kind: 'none' } },
    mask: mask === 'moat' ? moat(store, L.inCell) : { kind: 'zero' },
  })
  const sys = new CompiledSystem(cfg, store)
  const r = mulberry32(seed)
  const bits = L.idx.map(() => (r() < 0.5 ? 1 : 0))
  const f = createField(sys.grid)
  L.idx.forEach((a, k) => { if (bits[k]) for (const i of a) f.re[i] = Math.sqrt(2) })
  const checkpoints = new Set([1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000].filter((c) => c <= T).concat([T]))
  const rows: Record<string, number | string>[] = []
  let lastOn = 0
  for (let t = 1; t <= T; t++) {
    sys.roundTrip(f, NOIN)
    if (!checkpoints.has(t)) continue
    const I = cellI(f, L.idx)
    const on = I.filter((_, k) => bits[k]), off = I.filter((_, k) => !bits[k])
    const onMed = on.slice().sort((a, b) => a - b)[Math.floor(on.length / 2)] ?? 0
    // fixed decoder: absolute threshold at 30 % of the median on-level measured at t = 1 (then frozen)
    if (t === 1) lastOn = onMed
    const thr = 0.3 * lastOn
    const ber = I.reduce((a, v, k) => a + ((v > thr ? 1 : 0) !== bits[k] ? 1 : 0), 0) / I.length
    let bgMax = 0
    for (let i = 0; i < f.re.length; i++) if (!L.inCell[i]) bgMax = Math.max(bgMax, f.re[i] ** 2 + f.im[i] ** 2)
    rows.push({ mask, cellPx, pitchPx, cells: L.cells ** 2, G0, s, Ia, seed, t, ber, on_min: Math.min(...on), on_median: onMed, off_max: Math.max(0, ...off), false_activation: off.filter((v) => v > thr).length / Math.max(1, off.length), bg_max: bgMax })
  }
  // perturbation growth around the reached state (only meaningful if the pattern survived)
  let lyap = NaN
  const last = rows[rows.length - 1]
  if (last.ber === 0) {
    const eps = 1e-8
    const p = cloneField(f)
    const rr = mulberry32(seed + 99)
    let n2 = 0
    const d: number[] = []
    for (let i = 0; i < p.re.length; i++) { d.push(rr() - 0.5, rr() - 0.5); n2 += d[2 * i] ** 2 + d[2 * i + 1] ** 2 }
    for (let i = 0; i < p.re.length; i++) { p.re[i] += eps * d[2 * i] / Math.sqrt(n2); p.im[i] += eps * d[2 * i + 1] / Math.sqrt(n2) }
    let acc = 0, cnt = 0
    for (let t = 1; t <= 600; t++) {
      sys.roundTrip(f, NOIN); sys.roundTrip(p, NOIN)
      if (t % 20 === 0) {
        let dd = 0
        for (let i = 0; i < f.re.length; i++) dd += (p.re[i] - f.re[i]) ** 2 + (p.im[i] - f.im[i]) ** 2
        dd = Math.sqrt(dd)
        if (t > 200) { acc += Math.log(dd / eps); cnt += 20 }
        for (let i = 0; i < f.re.length; i++) { p.re[i] = f.re[i] + (p.re[i] - f.re[i]) * eps / dd; p.im[i] = f.im[i] + (p.im[i] - f.im[i]) * eps / dd }
      }
    }
    lyap = acc / cnt
    const I = new Float64Array(f.re.length)
    for (let i = 0; i < I.length; i++) I[i] = f.re[i] ** 2 + f.im[i] ** 2
    writeF64(`${OUT}02nl/state_${mask}_c${cellPx}p${pitchPx}_G${G0}_s${s}_Ia${Ia}_seed${seed}.f64`, I)
  }
  for (const row of rows) row.lyapunov_at_end = lyap
  return rows
}

if (process.argv[2]) {
  const [mask, cellS, pitches, G0s, sIas, Ts, tag] = process.argv.slice(2)
  const T = Number(Ts)
  const all: Record<string, number | string>[] = []
  for (const pitch of pitches.split(',').map(Number)) for (const G0 of G0s.split(',').map(Number)) for (const sIa of sIas.split(',')) {
    const [s, Ia] = sIa.split(':').map(Number)
    const t0 = performance.now()
    const res = [1, 2, 3].flatMap((seed) => run(mask, Number(cellS), pitch, G0, s, Ia, T, seed))
    all.push(...res)
    const fin = res.filter((q) => q.t === T)
    console.log(`${mask} cell ${cellS} pitch ${pitch} G0 ${G0} s ${s} Ia ${Ia}: BER@${T} ${fin.map((q) => (+q.ber).toFixed(3)).join('/')} onMed ${fin.map((q) => (+q.on_median).toFixed(2)).join('/')} offMax ${fin.map((q) => (+q.off_max).toFixed(3)).join('/')} λL ${fin.map((q) => (+q.lyapunov_at_end).toExponential(1)).join('/')} [${((performance.now() - t0) / 1000).toFixed(0)}s]`)
    writeCsv(`${OUT}02nl/mem_${tag ?? 'run'}.csv`, all)
  }
}
