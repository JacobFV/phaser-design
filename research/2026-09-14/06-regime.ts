// Experiment 6: operating regimes / edge of stability for the self-imaging SLM ring with local gain + saturable absorber (+ Kerr).
// For each (G0, s, κ, mask): random bit lattice → run T trips; Benettin largest Lyapunov exponent from a twin trajectory,
// pattern memory, BER, energy, fill fraction, input sensitivity (response to a late weak pulse).
// usage: npx vite-node 06-regime.ts <mask zero|moat> <kerr> <G0,...> <s,...> [T]
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { cloneField, createField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { mulberry32 } from '../../src/core/common/random'
import { slmRing } from './arch'
import { OUT, total, writeCsv } from './util'

export const LAT = { pitchPx: Number(process.env.PITCHPX ?? 4), cellPx: Number(process.env.CELLPX ?? 2), cells: Number(process.env.CELLS ?? 12) } // 12×12 cells of 2×2 px on a 4 px pitch (spp = 1 ⇒ px = sample)

/** Static "moat" program: 0 phase on cell pixels, π checkerboard elsewhere (scatters gap light outside the relay NA). */
export function moatProgram(store: AssetStore, res = 64, pitchPx = LAT.pitchPx, cellPx = LAT.cellPx, cells = LAT.cells, id = 'moat') {
  const data = new Float64Array(res * res)
  const span = cells * pitchPx, off = Math.floor((res - span) / 2) + Math.floor((pitchPx - cellPx) / 2)
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const inCell = (u: number) => u >= off && u < off + span && ((u - off) % pitchPx) < cellPx
    data[y * res + x] = inCell(x) && inCell(y) ? 0 : ((x + y) % 2) * Math.PI
  }
  return { kind: 'array' as const, ref: store.put(`${id}_${pitchPx}_${cellPx}`, res, res, data) }
}

export function cellIndex(res = 64, pitchPx = LAT.pitchPx, cellPx = LAT.cellPx, cells = LAT.cells) {
  const span = cells * pitchPx, off = Math.floor((res - span) / 2) + Math.floor((pitchPx - cellPx) / 2)
  const out: number[][] = []
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    const idx: number[] = []
    for (let dy = 0; dy < cellPx; dy++) for (let dx = 0; dx < cellPx; dx++) idx.push((off + cy * pitchPx + dy) * res + off + cx * pitchPx + dx)
    out.push(idx)
  }
  return out
}

const cellI = (f: Field, cells: number[][]) => cells.map((idx) => idx.reduce((s, i) => s + f.re[i] ** 2 + f.im[i] ** 2, 0) / idx.length)
const NOIN: RunContext = { cycle: 0, inputs: { take: () => null }, taps: { record: () => {} } }

function run(mask: string, kerr: number, G0: number, s: number, T: number, seed: number) {
  const store = new AssetStore()
  const cfg = slmRing({
    n: 64, spp: 1, roof: true, inputFirst: true,
    gain: { G0, sat: { kind: 'local', saturationIntensity: 1 } },
    nl: { amplitude: { kind: 'saturable', strength: s, saturationIntensity: 0.05 }, phase: kerr ? { kind: 'kerr', coefficient: kerr } : { kind: 'none' } },
    // constant π on the SLM makes the band-limited round trip resonant (arg λ1 ≈ −π without it)
    mask: mask === 'moat' ? moatProgram(store) : { kind: 'zero' },
  })
  const sys = new CompiledSystem(cfg, store)
  const g = sys.grid
  const cells = cellIndex()
  const r = mulberry32(seed)
  const bits = cells.map(() => (r() < 0.5 ? 1 : 0))
  const f = createField(g)
  cells.forEach((idx, k) => { if (bits[k]) for (const i of idx) f.re[i] = Math.sqrt(1.5) })
  for (let i = 0; i < f.re.length; i++) { f.re[i] += 1e-3 * (r() - 0.5); f.im[i] += 1e-3 * (r() - 0.5) }
  const I0 = cellI(f, cells)
  const E0 = total(f)
  // Benettin twin
  const eps = 1e-7
  const p = cloneField(f)
  let dn = 0
  for (let i = 0; i < f.re.length; i++) { const a = r() - 0.5, b = r() - 0.5; p.re[i] += a; p.im[i] += b; dn += a * a + b * b }
  const renorm = () => {
    let d = 0
    for (let i = 0; i < f.re.length; i++) d += (p.re[i] - f.re[i]) ** 2 + (p.im[i] - f.im[i]) ** 2
    d = Math.sqrt(d)
    const k = eps / d
    for (let i = 0; i < f.re.length; i++) { p.re[i] = f.re[i] + (p.re[i] - f.re[i]) * k; p.im[i] = f.im[i] + (p.im[i] - f.im[i]) * k }
    return d
  }
  // initial scaling of the perturbation to eps
  for (let i = 0; i < f.re.length; i++) { p.re[i] = f.re[i] + (p.re[i] - f.re[i]) * eps / Math.sqrt(dn); p.im[i] = f.im[i] + (p.im[i] - f.im[i]) * eps / Math.sqrt(dn) }
  let logSum = 0, logCount = 0
  const tail0 = Math.floor(T / 2)
  let Iprev: number[] = I0
  const trace: number[] = []
  // input-sensitivity probe: a clone receiving a weak pulse on one OFF cell at T/2
  let q: Field | null = null
  const offCell = bits.findIndex((b) => b === 0)
  for (let t = 1; t <= T; t++) {
    sys.roundTrip(f, NOIN)
    sys.roundTrip(p, NOIN)
    if (q) sys.roundTrip(q, NOIN)
    if (t % 10 === 0) {
      const d = renorm()
      if (t > tail0) { logSum += Math.log(d / eps); logCount += 10 }
    }
    if (t === tail0) {
      q = cloneField(f)
      for (const i of cells[offCell]) q.re[i] += Math.sqrt(0.05) // pulse ≈ absorber saturation level
      Iprev = cellI(f, cells)
    }
    if (t % Math.max(1, Math.floor(T / 50)) === 0) trace.push(total(f) / E0)
  }
  const IT = cellI(f, cells)
  const onLevel = Math.max(...IT)
  const thr = 0.3 * (Math.max(1.5, onLevel))
  const decoded = IT.map((v) => (v > 0.3 * 1.5 ? 1 : 0))
  const ber = decoded.reduce((a, b, k) => a + (b !== bits[k] ? 1 : 0), 0) / bits.length
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length
    let sab = 0, saa = 0, sbb = 0
    for (let k = 0; k < a.length; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2 }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
  }
  let fill = 0
  for (let i = 0; i < f.re.length; i++) if (f.re[i] ** 2 + f.im[i] ** 2 > 0.3) fill++
  const qI = q ? cellI(q, cells) : IT
  const inputResponse = Math.sqrt(qI.reduce((a, v, k) => a + (v - IT[k]) ** 2, 0))
  return {
    mask, cellPx: LAT.cellPx, pitchPx: LAT.pitchPx, cells: LAT.cells, kerr, G0, s, T, seed,
    lyapunov: logCount ? logSum / logCount : NaN,
    energy_final_rel: total(f) / E0, mean_cell_I: IT.reduce((a, b) => a + b, 0) / IT.length, max_cell_I: onLevel,
    pattern_corr_T_vs_0: corr(IT, I0), pattern_corr_T_vs_half: corr(IT, Iprev), ber, fill_fraction: fill / f.re.length,
    input_response: inputResponse, pulse_cell_final_I: qI[offCell], energy_trace: trace.map((v) => v.toExponential(3)).join(' '), thr,
  }
}

if (process.argv[2]) {
  const [mask, kerrS, G0s, ss, Ts] = process.argv.slice(2)
  const T = Number(Ts ?? 2000)
  const rows: Record<string, number | string>[] = []
  for (const G0 of G0s.split(',').map(Number)) for (const s of ss.split(',').map(Number)) {
    const t0 = performance.now()
    const row = run(mask, Number(kerrS), G0, s, T, 7)
    rows.push(row)
    console.log(`${mask} κ=${kerrS} G0=${G0} s=${s}: λL=${row.lyapunov.toExponential(2)} E=${row.energy_final_rel.toExponential(2)} corr0=${row.pattern_corr_T_vs_0.toFixed(3)} ber=${row.ber.toFixed(3)} fill=${row.fill_fraction.toFixed(3)} resp=${row.input_response.toExponential(2)} [${((performance.now() - t0) / 1000).toFixed(1)}s]`)
  }
  writeCsv(`${OUT}06/regime_${mask}_c${LAT.cellPx}p${LAT.pitchPx}_k${kerrS}_${G0s.replaceAll(',', '_')}_${ss.replaceAll(',', '_')}.csv`, rows)
}
