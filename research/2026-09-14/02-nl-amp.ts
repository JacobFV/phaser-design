// Experiment 2 (nonlinear), round 3: persistent bistable bits isolated by a static ABSORBING amplitude mask.
// Self-imaging SLM ring (10 mm steps) + a transmissive LCD in amplitude mode in the SLM plane: cell pixels clear, gap pixels
// dark. Gaps cannot lase at any gain, so switching fronts cannot propagate; each cell is its own bistable element.
// Local saturable gain + saturable absorber. 3 random patterns per point; BER / false activation / on-off levels at log
// checkpoints; perturbation growth (Benettin) around the reached state when the pattern survives.
// usage: npx vite-node 02-nl-amp.ts <cellPx,...> <gapPx,...> <G0,...> <s:Ia,...> <dark> <T> <tag>
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { cloneField, createField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { mulberry32 } from '../../src/core/common/random'
import type { OpticalElementSpec } from '../../src/core/physics/elements/types'
import type { CustomTopology } from '../../src/core/physics/topology/topology'
import { slmRing } from './arch'
import { OUT, writeCsv, writeF64 } from './util'

const NOIN: RunContext = { cycle: 0, inputs: { take: () => null }, taps: { record: () => {} } }

function lattice(cellPx: number, pitchPx: number, fovPx = 20, res = 64) {
  // flat field of view ±200 µm = 20 px of 20 µm pixels
  const cells = Math.max(1, Math.floor((fovPx - cellPx) / pitchPx) + 1)
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

function build(cellPx: number, gapPx: number, G0: number, s: number, Ia: number, dark: number) {
  const store = new AssetStore()
  const L = lattice(cellPx, cellPx + gapPx)
  const base = slmRing({
    n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3,
    gain: { G0, sat: { kind: 'local', saturationIntensity: 1 }, noise: Number(process.env.NOISE ?? 0) > 0 ? { kind: 'additive-gaussian', meanIntensity: Number(process.env.NOISE), seed: 17 } : undefined },
    nl: { amplitude: { kind: 'saturable', strength: s, saturationIntensity: Ia }, phase: { kind: 'none' } },
  })
  // drive u ≈ 1 (clear) on cell pixels, u = 0 (dark) elsewhere; amplitude-mode LCD maps T = dark + (clear − dark)·u
  const drive = new Float64Array(64 * 64)
  for (let i = 0; i < drive.length; i++) drive[i] = L.inCell[i] ? 2 * Math.PI * (255 / 256) : 0
  const amp: OpticalElementSpec = {
    kind: 'transmissive-lcd', id: 'amp', label: 'static absorbing cell mask',
    pixels: { resolution: { x: 64, y: 64 }, pitch: { x: 20e-6, y: 20e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } },
    modulation: { kind: 'amplitude', darkTransmission: dark, levels: 256 },
    clearTransmission: 1, surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
    polarizerTransmission: 1, deadZoneTransmission: 0, switchingTime: 0.01, designWavelength: 650e-9,
    program: { kind: 'array', ref: store.put(`amp_${cellPx}_${gapPx}`, 64, 64, drive) },
  }
  base.elements.push(amp)
  const topo = base.topology as CustomTopology
  const at = topo.route.findIndex((r) => r.kind === 'element' && r.elementId === 'slm')
  topo.route.splice(at + 1, 0, { kind: 'element', elementId: 'amp', side: 'front' })
  return { sys: new CompiledSystem(base, store), L }
}

const cellI = (f: Field, idx: number[][]) => idx.map((a) => a.reduce((s, i) => s + f.re[i] ** 2 + f.im[i] ** 2, 0) / a.length)

function run(cellPx: number, gapPx: number, G0: number, s: number, Ia: number, dark: number, T: number, seed: number) {
  const { sys, L } = build(cellPx, gapPx, G0, s, Ia, dark)
  const r = mulberry32(seed)
  const bits = L.idx.map(() => (r() < 0.5 ? 1 : 0))
  if (bits.every((b) => b === bits[0])) bits[0] = 1 - bits[0]
  const f = createField(sys.grid)
  L.idx.forEach((a, k) => { if (bits[k]) for (const i of a) f.re[i] = Math.sqrt(2) })
  const checkpoints = new Set([1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000].filter((c) => c <= T).concat([T]))
  const rows: Record<string, number | string>[] = []
  for (let t = 1; t <= T; t++) {
    sys.roundTrip(f, NOIN)
    if (!checkpoints.has(t)) continue
    const I = cellI(f, L.idx)
    const on = I.filter((_, k) => bits[k]), off = I.filter((_, k) => !bits[k])
    // fixed absolute decoder: threshold = half of the analytic ON level scale (I = 0.25); reported with the levels
    const thr = 0.25
    const ber = I.reduce((a, v, k) => a + ((v > thr ? 1 : 0) !== bits[k] ? 1 : 0), 0) / I.length
    let E = 0
    for (let i = 0; i < f.re.length; i++) E += f.re[i] ** 2 + f.im[i] ** 2
    rows.push({ noise: Number(process.env.NOISE ?? 0), cellPx, gapPx, pitch_um: (cellPx + gapPx) * 20, cells: L.idx.length, states_per_mm2: 1 / ((cellPx + gapPx) * 0.02) ** 2, G0, s, Ia, dark, seed, t,
      ber, on_min: Math.min(...on), on_mean: on.reduce((a, b) => a + b, 0) / on.length, off_max: Math.max(0, ...off), false_activation: off.filter((v) => v > thr).length / Math.max(1, off.length), energy: E })
  }
  let lyap = NaN, residual = NaN
  if (rows[rows.length - 1].ber === 0) {
    // fixed-point residual and perturbation growth around the reached state
    const g = cloneField(f)
    sys.roundTrip(g, NOIN)
    let d2 = 0, n2 = 0
    for (let i = 0; i < f.re.length; i++) { d2 += (g.re[i] - f.re[i]) ** 2 + (g.im[i] - f.im[i]) ** 2; n2 += f.re[i] ** 2 + f.im[i] ** 2 }
    residual = Math.sqrt(d2 / n2)
    const eps = 1e-8, rr = mulberry32(seed + 99)
    const p = cloneField(f)
    let pn = 0
    const u = new Float64Array(2 * f.re.length).map(() => rr() - 0.5)
    for (let i = 0; i < u.length; i++) pn += u[i] ** 2
    for (let i = 0; i < f.re.length; i++) { p.re[i] += eps * u[2 * i] / Math.sqrt(pn); p.im[i] += eps * u[2 * i + 1] / Math.sqrt(pn) }
    let acc = 0, cnt = 0
    for (let t = 1; t <= 400; t++) {
      sys.roundTrip(f, NOIN); sys.roundTrip(p, NOIN)
      if (t % 20 === 0) {
        let dd = 0
        for (let i = 0; i < f.re.length; i++) dd += (p.re[i] - f.re[i]) ** 2 + (p.im[i] - f.im[i]) ** 2
        dd = Math.sqrt(dd)
        if (t > 100) { acc += Math.log(dd / eps); cnt += 20 }
        for (let i = 0; i < f.re.length; i++) { p.re[i] = f.re[i] + (p.re[i] - f.re[i]) * eps / dd; p.im[i] = f.im[i] + (p.im[i] - f.im[i]) * eps / dd }
      }
    }
    lyap = acc / cnt
    const I = new Float64Array(f.re.length)
    for (let i = 0; i < I.length; i++) I[i] = f.re[i] ** 2 + f.im[i] ** 2
    writeF64(`${OUT}02nl/amp_state_c${cellPx}g${gapPx}_G${G0}_s${s}_Ia${Ia}_d${dark}_seed${seed}.f64`, I)
  }
  for (const row of rows) { row.lyapunov_at_end = lyap; row.fixed_point_residual = residual }
  return rows
}

if (process.argv[2]) {
  const [cellS, gapS, G0S, sIaS, darkS, TS, tag] = process.argv.slice(2)
  const SEEDS = (process.env.SEEDS ?? '1,2,3').split(',').map(Number)
  const T = Number(TS)
  const all: Record<string, number | string>[] = []
  for (const c of cellS.split(',').map(Number)) for (const gp of gapS.split(',').map(Number)) for (const G0 of G0S.split(',').map(Number)) for (const sIa of sIaS.split(',')) {
    const [s, Ia] = sIa.split(':').map(Number)
    const t0 = performance.now()
    const res = SEEDS.flatMap((seed) => run(c, gp, G0, s, Ia, Number(darkS), T, seed))
    all.push(...res)
    const fin = res.filter((q) => q.t === T)
    console.log(`amp cell ${c} gap ${gp} G0 ${G0} s ${s} Ia ${Ia} dark ${darkS}: BER@${T} ${fin.map((q) => (+q.ber).toFixed(3)).join('/')} onMean ${fin.map((q) => (+q.on_mean).toFixed(2)).join('/')} offMax ${fin.map((q) => (+q.off_max).toFixed(3)).join('/')} λL ${fin.map((q) => (+q.lyapunov_at_end).toExponential(1)).join('/')} resid ${fin.map((q) => (+q.fixed_point_residual).toExponential(1)).join('/')} [${((performance.now() - t0) / 1000).toFixed(0)}s]`)
    writeCsv(`${OUT}02nl/amp_${tag}.csv`, all)
  }
}
