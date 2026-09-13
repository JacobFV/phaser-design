import type { AssetResolver } from '../../physics/assets'
import { NULL_CONTEXT } from '../../physics/elements/element'
import { isProgrammable, type Vec2 } from '../../physics/elements/types'
import { createField, sampleX, sampleY, scaleField, type Field } from '../../physics/field/grid'
import { CompiledSystem, type PhysicsConfig } from '../../physics/system'

/**
 * State characterisation: how small and how densely packed can a spatial state be and still survive recurrence?
 *
 * A Gaussian blob (intensity rms radius σ per axis) is launched into the route with no input and no algorithm, and
 * shape metrics are recorded every cycle. Results are FINITE-HORIZON numerical statements; they never prove
 * infinite-time stability. For linear routes an asymptotic eigenmode estimate is added separately.
 */
export interface StabilityThresholds {
  minCorrelation: number // intensity-shape correlation with the launched blob
  maxWidthDriftPerCycle: number // |dσ/dt| / σ0 per cycle over the trailing window
  maxCentroidDriftPerCycle: number // |dc/dt| / σ0 per cycle over the trailing window
  maxLeakage: number // power fraction outside the blob's own cell (side = separation)
  maxCrosstalk: number // power fraction landing in the strongest neighbouring cell
  energy: { kind: 'bounded'; maxLogGrowthPerCycle: number } | { kind: 'ignore' }
}

export const DEFAULT_THRESHOLDS: StabilityThresholds = {
  minCorrelation: 0.9,
  maxWidthDriftPerCycle: 1e-3,
  maxCentroidDriftPerCycle: 1e-3,
  maxLeakage: 0.1,
  maxCrosstalk: 0.05,
  energy: { kind: 'ignore' },
}

export interface CharacterizationRequest {
  sigmas: number[] // m
  separations: number[] // m; cell pitch candidates for density
  horizons: number[] // cycles, e.g. [1, 10, 100, 1000, 10000]
  thresholds: StabilityThresholds
  center?: Vec2
}

export interface BlobTrace {
  sigma0: number
  cycles: number[]
  energy: number[] // mean intensity
  centroidX: number[]
  centroidY: number[]
  sigma: number[] // rms radius (mean of x and y)
  fwhm: number[] // estimate along x through the centroid
  correlation: number[]
  fidelity: number[] // |⟨E0|E⟩|² / (‖E0‖²‖E‖²)
}

export interface HorizonResult {
  horizon: number
  correlation: number
  fidelity: number
  sigmaRatio: number
  survivesShape: boolean
  minSeparation: number | null // smallest tested separation meeting leakage and cross-talk at this horizon
}

export interface BlobTrial {
  sigma: number
  trace: BlobTrace
  horizons: HorizonResult[]
  drift: { widthPerCycle: number; centroidPerCycle: number; logGrowthPerCycle: number }
  stable: boolean // shape, drift and energy criteria all met at the longest horizon
  reasons: string[]
}

export interface DensityEstimate {
  horizon: number
  minSigma: number | null
  minSeparation: number | null
  statesPerMm2: number | null
  statesAcrossAperture: number | null
}

export interface CharacterizationResult {
  kind: 'numerical'
  horizonCycles: number
  aperture: number // m², area used for "states across aperture"
  trials: BlobTrial[]
  minStableSigma: number | null
  stable: DensityEstimate
  transient: DensityEstimate[]
  monotonic: boolean // false if a larger σ failed where a smaller one passed (search result is then suspect)
  asymptotic: { kind: 'asymptotic'; available: boolean; eigenvalue?: number; modeSigma?: number; iterations?: number; note: string }
  warnings: string[]
}

function launchBlob(f: Field, sigma: number, c: Vec2) {
  const g = f.grid
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const r2 = (sampleX(g, i) - c.x) ** 2 + (sampleY(g, j) - c.y) ** 2
      f.re[j * g.nx + i] = Math.exp(-r2 / (4 * sigma * sigma))
      f.im[j * g.nx + i] = 0
    }
}

interface Moments { power: number; cx: number; cy: number; sigma: number; fwhm: number }

function moments(f: Field): Moments {
  const g = f.grid
  let p = 0, sx = 0, sy = 0, sxx = 0, syy = 0
  for (let j = 0; j < g.ny; j++) {
    const y = sampleY(g, j)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i
      const I = f.re[k] ** 2 + f.im[k] ** 2
      const x = sampleX(g, i)
      p += I; sx += I * x; sy += I * y; sxx += I * x * x; syy += I * y * y
    }
  }
  if (p <= 0) return { power: 0, cx: 0, cy: 0, sigma: 0, fwhm: 0 }
  const cx = sx / p, cy = sy / p
  const vx = Math.max(0, sxx / p - cx * cx), vy = Math.max(0, syy / p - cy * cy)
  // FWHM along the row through the centroid, with linear interpolation of the half-maximum crossings
  const row = Math.min(g.ny - 1, Math.max(0, Math.round(cy / g.dy + g.ny / 2 - 0.5)))
  let peak = 0, pi = 0
  for (let i = 0; i < g.nx; i++) {
    const I = f.re[row * g.nx + i] ** 2 + f.im[row * g.nx + i] ** 2
    if (I > peak) { peak = I; pi = i }
  }
  const at = (i: number) => f.re[row * g.nx + i] ** 2 + f.im[row * g.nx + i] ** 2
  let l = pi, r = pi
  while (l > 0 && at(l - 1) > peak / 2) l--
  while (r < g.nx - 1 && at(r + 1) > peak / 2) r++
  const edge = (a: number, b: number) => (at(a) === at(b) ? a : a + (peak / 2 - at(a)) / (at(b) - at(a)) * (b - a))
  const left = l > 0 ? edge(l - 1, l) : 0
  const right = r < g.nx - 1 ? edge(r + 1, r) : g.nx - 1
  return { power: p, cx, cy, sigma: Math.sqrt((vx + vy) / 2), fwhm: (right - left) * g.dx }
}

function correlation(a: Field, b: Field): { corr: number; fid: number } {
  const n = a.re.length
  let ma = 0, mb = 0
  const Ia = new Float64Array(n), Ib = new Float64Array(n)
  let ore = 0, oim = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    Ia[i] = a.re[i] ** 2 + a.im[i] ** 2
    Ib[i] = b.re[i] ** 2 + b.im[i] ** 2
    ma += Ia[i]; mb += Ib[i]
    ore += a.re[i] * b.re[i] + a.im[i] * b.im[i]
    oim += a.re[i] * b.im[i] - a.im[i] * b.re[i]
    na += Ia[i]; nb += Ib[i]
  }
  ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    const da = Ia[i] - ma, db = Ib[i] - mb
    sab += da * db; saa += da * da; sbb += db * db
  }
  return { corr: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0, fid: na > 0 && nb > 0 ? (ore * ore + oim * oim) / (na * nb) : 0 }
}

/** Fraction of power inside the square of side s centred at c. */
function cellFraction(f: Field, c: Vec2, s: number, total: number): number {
  const g = f.grid
  let inside = 0
  for (let j = 0; j < g.ny; j++) {
    const y = sampleY(g, j)
    if (Math.abs(y - c.y) > s / 2) continue
    for (let i = 0; i < g.nx; i++) {
      if (Math.abs(sampleX(g, i) - c.x) > s / 2) continue
      const k = j * g.nx + i
      inside += f.re[k] ** 2 + f.im[k] ** 2
    }
  }
  return total > 0 ? inside / total : 0
}

function separationOk(f: Field, c: Vec2, s: number, t: StabilityThresholds): boolean {
  const g = f.grid
  const halfW = (g.nx * g.dx) / 2, halfH = (g.ny * g.dy) / 2
  let total = 0
  for (let i = 0; i < f.re.length; i++) total += f.re[i] ** 2 + f.im[i] ** 2
  if (1 - cellFraction(f, c, s, total) > t.maxLeakage) return false
  for (const [dx, dy] of [[s, 0], [-s, 0], [0, s], [0, -s]]) {
    const n = { x: c.x + dx, y: c.y + dy }
    if (Math.abs(n.x) + s / 2 > halfW || Math.abs(n.y) + s / 2 > halfH) continue // neighbour outside the window
    if (cellFraction(f, n, s, total) > t.maxCrosstalk) return false
  }
  return true
}

/** Least-squares slope of y over x. */
function slope(x: number[], y: number[]): number {
  const n = x.length
  if (n < 2) return 0
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2 }
  return den > 0 ? num / den : 0
}

export function traceAndEvaluate(sys: CompiledSystem, sigma: number, req: CharacterizationRequest): BlobTrial {
  const c = req.center ?? { x: 0, y: 0 }
  const horizons = [...new Set(req.horizons)].filter((h) => h >= 1).sort((a, b) => a - b)
  const maxH = horizons[horizons.length - 1] ?? 1
  const t = req.thresholds
  sys.resetElementState()
  const f = createField(sys.grid)
  launchBlob(f, sigma, c)
  const f0 = createField(sys.grid)
  f0.re.set(f.re)
  const m0 = moments(f)
  const trace: BlobTrace = { sigma0: m0.sigma, cycles: [0], energy: [m0.power / f.re.length], centroidX: [m0.cx], centroidY: [m0.cy], sigma: [m0.sigma], fwhm: [m0.fwhm], correlation: [1], fidelity: [1] }
  const results: HorizonResult[] = []
  const logEvery = Math.max(1, Math.floor(maxH / 400))
  for (let n = 1; n <= maxH; n++) {
    sys.roundTrip(f, NULL_CONTEXT)
    const isHorizon = horizons.includes(n)
    if (n % logEvery !== 0 && !isHorizon && n !== maxH) continue
    const m = moments(f)
    const { corr, fid } = correlation(f0, f)
    trace.cycles.push(n); trace.energy.push(m.power / f.re.length); trace.centroidX.push(m.cx); trace.centroidY.push(m.cy)
    trace.sigma.push(m.sigma); trace.fwhm.push(m.fwhm); trace.correlation.push(corr); trace.fidelity.push(fid)
    if (isHorizon) {
      const minSep = req.separations.slice().sort((a, b) => a - b).find((s) => separationOk(f, c, s, t)) ?? null
      results.push({ horizon: n, correlation: corr, fidelity: fid, sigmaRatio: m.sigma / m0.sigma, survivesShape: corr >= t.minCorrelation, minSeparation: minSep })
    }
    if (m.power === 0) break
  }

  // drift rates over the trailing quarter of the run
  const k0 = Math.floor(trace.cycles.length * 0.75)
  const xs = trace.cycles.slice(k0)
  const widthPerCycle = Math.abs(slope(xs, trace.sigma.slice(k0))) / m0.sigma
  const centroidPerCycle = Math.hypot(slope(xs, trace.centroidX.slice(k0)), slope(xs, trace.centroidY.slice(k0))) / m0.sigma
  const logE = trace.energy.slice(k0).map((e) => Math.log(Math.max(e, 1e-300)))
  const logGrowthPerCycle = slope(xs, logE)

  const reasons: string[] = []
  const last = results[results.length - 1]
  if (!last || !last.survivesShape) reasons.push('shape correlation below threshold')
  if (last && last.minSeparation === null) reasons.push('no tested separation meets leakage/cross-talk')
  if (widthPerCycle > t.maxWidthDriftPerCycle) reasons.push('width still drifting')
  if (centroidPerCycle > t.maxCentroidDriftPerCycle) reasons.push('centroid still drifting')
  if (t.energy.kind === 'bounded' && Math.abs(logGrowthPerCycle) > t.energy.maxLogGrowthPerCycle) reasons.push('energy not in a bounded regime')
  return { sigma, trace, horizons: results, drift: { widthPerCycle, centroidPerCycle, logGrowthPerCycle }, stable: reasons.length === 0, reasons }
}

/** Dominant eigenmode of a linear round-trip operator by power iteration. */
function eigenmode(sys: CompiledSystem, iterations: number): CharacterizationResult['asymptotic'] {
  if (!sys.isLinear()) return { kind: 'asymptotic', available: false, note: 'route contains intensity-dependent elements; no linear eigenmode' }
  const f = createField(sys.grid)
  launchBlob(f, (sys.grid.nx * sys.grid.dx) / 6, { x: 0, y: 0 })
  let lambda = 0
  for (let n = 0; n < iterations; n++) {
    const before = moments(f).power
    sys.roundTrip(f, NULL_CONTEXT)
    const after = moments(f).power
    if (after <= 0) return { kind: 'asymptotic', available: true, eigenvalue: 0, iterations: n + 1, note: 'field fully extinguished' }
    lambda = Math.sqrt(after / before)
    scaleField(f, 1 / Math.sqrt(after / f.re.length))
  }
  return { kind: 'asymptotic', available: true, eigenvalue: lambda, modeSigma: moments(f).sigma, iterations, note: '|λ| per round trip (amplitude) of the dominant mode after power iteration' }
}

export function characterize(
  physics: PhysicsConfig,
  assets: AssetResolver,
  req: CharacterizationRequest,
  onProgress?: (done: number, total: number) => void,
): CharacterizationResult {
  const sys = new CompiledSystem(physics, assets)
  const sigmas = [...req.sigmas].sort((a, b) => a - b)
  const trials: BlobTrial[] = []
  sigmas.forEach((s, i) => {
    trials.push(traceAndEvaluate(sys, s, req))
    onProgress?.(i + 1, sigmas.length + 1)
  })
  const horizons = [...new Set(req.horizons)].filter((h) => h >= 1).sort((a, b) => a - b)
  const maxH = horizons[horizons.length - 1] ?? 1

  const grid = sys.grid
  const window = grid.nx * grid.dx * grid.ny * grid.dy
  const deviceAreas = physics.elements.filter(isProgrammable).map((e) => {
    const px = e.kind === 'lcd-microlens' ? e.lcd.pixels : e.pixels
    return px.resolution.x * px.pitch.x * px.resolution.y * px.pitch.y
  })
  const aperture = Math.min(window, ...deviceAreas)

  const density = (horizon: number, pass: (t: BlobTrial, h: HorizonResult) => boolean): DensityEstimate => {
    for (const t of trials) {
      const h = t.horizons.find((x) => x.horizon === horizon)
      if (h && pass(t, h) && h.minSeparation !== null) {
        const s = h.minSeparation
        return { horizon, minSigma: t.sigma, minSeparation: s, statesPerMm2: 1e-6 / (s * s), statesAcrossAperture: Math.floor(aperture / (s * s)) }
      }
    }
    return { horizon, minSigma: null, minSeparation: null, statesPerMm2: null, statesAcrossAperture: null }
  }

  const firstStable = trials.findIndex((t) => t.stable)
  const monotonic = firstStable < 0 || trials.slice(firstStable).every((t) => t.stable)
  const warnings = sys.warnings()
  if (physics.field.boundary.kind === 'periodic') warnings.push('periodic boundary: light leaving the window re-enters on the other side and can masquerade as coupling')
  if (!monotonic) warnings.push('stability is not monotonic in σ over the tested range; the minimum is not a clean threshold')
  if (maxH < 1000) warnings.push(`longest horizon is ${maxH} cycles: "stable" means stable over that horizon only`)

  const asymptotic = eigenmode(sys, Math.min(maxH, 500))
  onProgress?.(sigmas.length + 1, sigmas.length + 1)
  return {
    kind: 'numerical',
    horizonCycles: maxH,
    aperture,
    trials,
    minStableSigma: firstStable >= 0 ? trials[firstStable].sigma : null,
    stable: density(maxH, (t) => t.stable),
    transient: horizons.map((h) => density(h, (_t, r) => r.survivesShape)),
    monotonic,
    asymptotic,
    warnings,
  }
}
