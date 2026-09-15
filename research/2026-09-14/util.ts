/** Scratch helpers shared by this sprint's one-off scripts: field metrics and dumb file writers. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField, sampleX, sampleY, type Field } from '../../src/core/physics/field/grid'
import type { CompiledSystem } from '../../src/core/physics/system'

export const OUT = new URL('./out/', import.meta.url).pathname
export const BIG = '/private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/big/'

export function ensure(path: string) { mkdirSync(dirname(path), { recursive: true }); return path }

export function writeCsv(path: string, rows: Record<string, number | string>[]) {
  if (!rows.length) return
  const keys = Object.keys(rows[0])
  writeFileSync(ensure(path), [keys.join(','), ...rows.map((r) => keys.map((k) => r[k]).join(','))].join('\n') + '\n')
}
export const writeJson = (path: string, v: unknown) => writeFileSync(ensure(path), JSON.stringify(v, null, 1))
export function writeF64(path: string, a: Float64Array) { writeFileSync(ensure(path), new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) }

/** Gaussian with INTENSITY rms radius σ (amplitude exp(−r²/4σ²)), added to f. */
export function addGaussian(f: Field, sigma: number, cx: number, cy: number, amp = 1, phase = 0) {
  const g = f.grid, c = Math.cos(phase) * amp, s = Math.sin(phase) * amp
  for (let j = 0; j < g.ny; j++) {
    const dy = sampleY(g, j) - cy
    for (let i = 0; i < g.nx; i++) {
      const dx = sampleX(g, i) - cx
      const e = Math.exp(-(dx * dx + dy * dy) / (4 * sigma * sigma))
      f.re[j * g.nx + i] += c * e
      f.im[j * g.nx + i] += s * e
    }
  }
}

export const intensity = (f: Field) => { const I = new Float64Array(f.re.length); for (let i = 0; i < I.length; i++) I[i] = f.re[i] ** 2 + f.im[i] ** 2; return I }
export const total = (f: Field) => { let s = 0; for (let i = 0; i < f.re.length; i++) s += f.re[i] ** 2 + f.im[i] ** 2; return s }

/** Moments of the intensity within radius R of (cx, cy) (R = Infinity: whole window). σ = rms radius per axis. */
export function moments(f: Field, cx = 0, cy = 0, R = Infinity) {
  const g = f.grid
  let p = 0, sx = 0, sy = 0, sxx = 0, syy = 0, peak = 0
  for (let j = 0; j < g.ny; j++) {
    const y = sampleY(g, j)
    for (let i = 0; i < g.nx; i++) {
      const x = sampleX(g, i)
      if (R < Infinity && (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue
      const k = j * g.nx + i
      const I = f.re[k] ** 2 + f.im[k] ** 2
      p += I; sx += I * x; sy += I * y; sxx += I * x * x; syy += I * y * y
      if (I > peak) peak = I
    }
  }
  if (p <= 0) return { power: 0, cx: NaN, cy: NaN, sigma: NaN, peak: 0 }
  const mx = sx / p, my = sy / p
  return { power: p, cx: mx, cy: my, sigma: Math.sqrt(Math.max(0, (sxx / p - mx * mx + syy / p - my * my) / 2)), peak }
}

/** FWHM of intensity along x and y through the peak, linear interpolation; area-equivalent FWHM = 2√(A_half/π). */
export function fwhm(f: Field) {
  const I = intensity(f), g = f.grid
  let peak = 0, k0 = 0
  for (let i = 0; i < I.length; i++) if (I[i] > peak) { peak = I[i]; k0 = i }
  let above = 0
  for (let i = 0; i < I.length; i++) if (I[i] >= peak / 2) above++
  return { areaFwhm: 2 * Math.sqrt((above * g.dx * g.dy) / Math.PI), peakX: sampleX(g, k0 % g.nx), peakY: sampleY(g, Math.floor(k0 / g.nx)) }
}

/** Pearson correlation of intensities; complex fidelity |⟨a|b⟩|²/(‖a‖²‖b‖²); phase-profile agreement weighted by |a||b|. */
export function compare(a: Field, b: Field) {
  const n = a.re.length
  let ma = 0, mb = 0, ore = 0, oim = 0, na = 0, nb = 0, absab = 0
  const Ia = new Float64Array(n), Ib = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    Ia[i] = a.re[i] ** 2 + a.im[i] ** 2; Ib[i] = b.re[i] ** 2 + b.im[i] ** 2
    ma += Ia[i]; mb += Ib[i]
    ore += a.re[i] * b.re[i] + a.im[i] * b.im[i]
    oim += a.re[i] * b.im[i] - a.im[i] * b.re[i]
    absab += Math.sqrt(Ia[i] * Ib[i])
  }
  na = ma; nb = mb; ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { const da = Ia[i] - ma, db = Ib[i] - mb; sab += da * db; saa += da * da; sbb += db * db }
  return {
    corr: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0,
    fidelity: na > 0 && nb > 0 ? (ore * ore + oim * oim) / (na * nb) : 0,
    phaseCoherence: absab > 0 ? Math.hypot(ore, oim) / absab : 0, // 1 = identical phase profile up to a global phase
  }
}

/** Fraction of total power inside a disc. */
export function discFraction(f: Field, cx: number, cy: number, R: number) {
  const g = f.grid
  let inside = 0, tot = 0
  for (let j = 0; j < g.ny; j++) {
    const y = sampleY(g, j)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i
      const I = f.re[k] ** 2 + f.im[k] ** 2
      tot += I
      if ((sampleX(g, i) - cx) ** 2 + (y - cy) ** 2 <= R * R) inside += I
    }
  }
  return tot > 0 ? inside / tot : 0
}

/** Power (Σ|E|²) in a disc, not normalised. */
export function discPower(f: Field, cx: number, cy: number, R: number) {
  const g = f.grid
  let s = 0
  const i0 = Math.max(0, Math.floor((cx - R) / g.dx + g.nx / 2 - 0.5)), i1 = Math.min(g.nx - 1, Math.ceil((cx + R) / g.dx + g.nx / 2 - 0.5))
  const j0 = Math.max(0, Math.floor((cy - R) / g.dy + g.ny / 2 - 0.5)), j1 = Math.min(g.ny - 1, Math.ceil((cy + R) / g.dy + g.ny / 2 - 0.5))
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if ((sampleX(g, i) - cx) ** 2 + (sampleY(g, j) - cy) ** 2 > R * R) continue
    const k = j * g.nx + i
    s += f.re[k] ** 2 + f.im[k] ** 2
  }
  return s
}

/** Complex field summed over a disc (a coherent "detector"). */
export function discAmplitude(f: Field, cx: number, cy: number, R: number) {
  const g = f.grid
  let re = 0, im = 0
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    if ((sampleX(g, i) - cx) ** 2 + (sampleY(g, j) - cy) ** 2 > R * R) continue
    re += f.re[j * g.nx + i]; im += f.im[j * g.nx + i]
  }
  return { re, im }
}

/** Explicit complex round-trip matrix, column-major, interleaved (re, im) float64: M[:, k] = roundTrip(e_k). Linear routes only. */
export function extractMatrix(sys: CompiledSystem): Float64Array {
  if (!sys.isLinear()) throw new Error('route is not linear')
  const N = sys.grid.nx * sys.grid.ny
  const out = new Float64Array(2 * N * N)
  const f = createField(sys.grid)
  for (let k = 0; k < N; k++) {
    f.re.fill(0); f.im.fill(0); f.re[k] = 1
    sys.roundTrip(f, NULL_CONTEXT)
    for (let i = 0; i < N; i++) { out[2 * (k * N + i)] = f.re[i]; out[2 * (k * N + i) + 1] = f.im[i] }
  }
  return out
}

export const logCheckpoints = (max: number) => {
  const s = new Set<number>([0])
  for (let e = 0; 10 ** e <= max; e += 0.125) s.add(Math.round(10 ** e))
  s.add(max)
  return [...s].sort((a, b) => a - b)
}
