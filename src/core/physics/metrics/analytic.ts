import { isProgrammable } from '../elements/types'
import type { CompiledSystem } from '../system'

/**
 * Every metric states how it was obtained:
 *  - analytical: closed-form estimate from configuration (fast, idealised — shows where simple formulas break)
 *  - numerical:  measured by running the field solver
 *  - asymptotic: fixed-point / eigenmode estimate of long-time behaviour
 */
export type MetricKind = 'analytical' | 'numerical' | 'asymptotic'

export interface Metric {
  key: string
  label: string
  value: number
  unit: string
  kind: MetricKind
  group: 'timing' | 'loss' | 'diffraction' | 'capacity' | 'throughput' | 'io'
  note?: string
}

export function analyticMetrics(sys: CompiledSystem): Metric[] {
  const m: Metric[] = []
  const add = (x: Metric) => m.push(x)
  const t = sys.timing()
  const { grid, wavelength: lambda } = sys
  const steps = sys.route.steps

  // ── timing ─────────────────────────────────────────────────────────────────────────────────
  add({ key: 'geometricLength', label: 'round-trip geometric length', value: t.geometricLength, unit: 'm', kind: 'analytical', group: 'timing' })
  add({ key: 'roundTripTime', label: 'round-trip time $\\sum n_g L / c$', value: t.roundTripTime, unit: 's', kind: 'analytical', group: 'timing' })
  add({ key: 'roundTripFrequency', label: 'round trips per second', value: t.roundTripFrequency, unit: 'Hz', kind: 'analytical', group: 'timing' })

  // ── loss / gain ────────────────────────────────────────────────────────────────────────────
  const budget = sys.powerBudget()
  let passive = 1, gain = 1
  budget.forEach((b, k) => {
    const s = steps[k]
    const el = s.kind === 'element' ? sys.elements.get(s.elementId) : null
    if (el?.spec.kind === 'gain') gain *= b.transmission
    else passive *= b.transmission
  })
  const loop = passive * gain
  add({ key: 'passiveRetention', label: 'passive power retention / round trip', value: passive, unit: '', kind: 'analytical', group: 'loss', note: 'uniform illumination; excludes diffraction out of apertures' })
  add({ key: 'smallSignalGain', label: 'small-signal gain / round trip', value: gain, unit: '', kind: 'analytical', group: 'loss' })
  add({ key: 'loopGain', label: 'small-signal loop gain', value: loop, unit: '', kind: 'analytical', group: 'loss' })
  add({ key: 'logGrowthPerCycle', label: 'dominant growth $\\ln G_\\mathrm{loop}$ / cycle', value: Math.log(loop), unit: '1/cycle', kind: 'analytical', group: 'loss', note: 'saturation, nonlinearity and diffraction loss can change this' })
  add({ key: 'retention1000', label: 'passive retention after 1000 cycles', value: Math.pow(passive, 1000), unit: '', kind: 'analytical', group: 'loss' })

  // ── diffraction ────────────────────────────────────────────────────────────────────────────
  const freePath = steps.reduce((s, x) => s + (x.kind === 'propagate' ? x.length : 0), 0)
  const segs = steps.filter((x) => x.kind === 'propagate')
  const meanSeg = segs.length ? freePath / segs.length : 0
  const naGrid = Math.min(1, lambda / (2 * Math.max(grid.dx, grid.dy)))
  add({ key: 'gridNA', label: 'max angle represented by the grid ($\\sin\\theta$)', value: naGrid, unit: '', kind: 'analytical', group: 'diffraction' })

  // Gaussian beam: w(L) = w0 √(1 + (L/z_R)²), z_R = π w0² / λ (paraxial, ignores focusing elements).
  const eps = 0.01
  const wStable = Math.sqrt((lambda * freePath) / (Math.PI * Math.sqrt((1 + eps) ** 2 - 1)))
  add({
    key: 'minWaistOneTrip', label: 'waist $w_0$ growing $\\le 1\\,\\%$ per round trip (free space)', value: wStable, unit: 'm', kind: 'analytical', group: 'diffraction',
    note: 'w0 = √(λL/(π√((1+ε)²−1))); ignores lenses, apertures and masks',
  })

  const devices = sys.config.elements.filter(isProgrammable).map((e) => {
    const px = e.kind === 'lcd-microlens' ? e.lcd.pixels : e.pixels
    return { id: e.id, pitch: Math.max(px.pitch.x, px.pitch.y), count: px.resolution.x * px.resolution.y, area: px.resolution.x * px.pitch.x * px.resolution.y * px.pitch.y }
  })
  const modPixels = devices.reduce((s, d) => s + d.count, 0)
  let efferents = 0
  if (devices.length) {
    const pitch = devices.reduce((s, d) => s + d.pitch, 0) / devices.length
    const theta = (1.22 * lambda) / pitch
    const rc = meanSeg * Math.tan(theta)
    efferents = (Math.PI * rc * rc) / (pitch * pitch)
    add({ key: 'pixelDiffractionAngle', label: 'pixel diffraction half-angle $1.22\\,\\lambda/D$', value: theta, unit: 'rad', kind: 'analytical', group: 'diffraction' })
    add({ key: 'couplingRadius', label: 'local coupling radius per segment', value: rc, unit: 'm', kind: 'analytical', group: 'diffraction', note: 'mean segment length × tan θ' })
    add({ key: 'efferentsPerPixel', label: 'downstream pixels reached ($\\pi r^2 / D^2$)', value: efferents, unit: '', kind: 'analytical', group: 'diffraction' })
  }

  // ── capacity: samples ≠ pixels ≠ modes ≠ states ────────────────────────────────────────────
  const window = grid.nx * grid.dx * grid.ny * grid.dy
  const aperture = devices.length ? Math.min(window, ...devices.map((d) => d.area)) : window
  const samples = grid.nx * grid.ny
  const fc = Math.min(1 / (2 * grid.dx), devices.length ? 1 / (2 * Math.min(...devices.map((d) => d.pitch))) : Infinity)
  const modes = aperture * (2 * fc) ** 2
  const stableSpacing = 3 * wStable // ≈ 1 % overlap between neighbouring Gaussian states
  const stableStates = aperture / (stableSpacing * stableSpacing)
  add({ key: 'physicalSamples', label: 'physical field samples', value: samples, unit: '', kind: 'analytical', group: 'capacity' })
  add({ key: 'modulatorPixels', label: 'programmable modulator pixels', value: modPixels, unit: '', kind: 'analytical', group: 'capacity' })
  add({ key: 'effectiveModes', label: 'effective spatial modes across aperture', value: modes, unit: '', kind: 'analytical', group: 'capacity', note: 'aperture × (2 f_c)², f_c limited by grid and pixel sampling' })
  add({ key: 'stableStatesAnalytic', label: 'free-space stable states across aperture', value: stableStates, unit: '', kind: 'analytical', group: 'capacity', note: 'aperture / (3 w0)²; the blob characterisation measures this numerically' })

  // ── throughput proxies (explicitly not FLOPs) ──────────────────────────────────────────────
  const f = t.roundTripFrequency
  add({ key: 'fieldUpdatesPerSec', label: 'physical field-sample updates / s', value: samples * f, unit: '1/s', kind: 'analytical', group: 'throughput', note: 'simulation samples, not independent degrees of freedom' })
  add({ key: 'modeUpdatesPerSec', label: 'effective mode updates / s', value: modes * f, unit: '1/s', kind: 'analytical', group: 'throughput' })
  add({ key: 'localInteractionsPerSec', label: 'local coupling interactions / s', value: modPixels * efferents * f, unit: '1/s', kind: 'analytical', group: 'throughput', note: 'proxy: pixels × efferents × round trips/s. Not FLOPs' })

  // ── I/O ────────────────────────────────────────────────────────────────────────────────────
  const slowest = sys.config.elements.filter(isProgrammable).reduce((s, e) => Math.max(s, e.kind === 'lcd-microlens' ? e.lcd.switchingTime : 'switchingTime' in e ? (e as { switchingTime: number }).switchingTime : 0), 0)
  if (slowest > 0) {
    add({ key: 'maskUpdateRate', label: 'mask program updates / s (slowest device)', value: 1 / slowest, unit: 'Hz', kind: 'analytical', group: 'io' })
    add({ key: 'cyclesPerMaskUpdate', label: 'optical cycles per mask update', value: f * slowest, unit: '', kind: 'analytical', group: 'io' })
  }
  for (const r of sys.config.readouts) {
    const pixels = (grid.nx / (r.bin?.x ?? 1)) * (grid.ny / (r.bin?.y ?? 1))
    add({ key: `readoutBandwidth:${r.id}`, label: `samples/s to read "${r.id}" every cycle`, value: pixels * f, unit: '1/s', kind: 'analytical', group: 'io' })
  }
  return m
}
