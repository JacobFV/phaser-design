import { addScaled, meanIntensity, multiplyComplex, sampleX, sampleY, scaleField, type Field, type GridSpec } from '../field/grid'
import { resolveMedium } from '../media/media'
import { propagate, type PropagationKernel } from '../propagation/angularSpectrum'
import { gaussian, mulberry32 } from '../random'
import type { ElementEnv, OpticalElement, RunContext } from './element'
import { achievedPhase, buildPixelMap, driveLevel, evaluateProgram } from './pixels'
import type {
  ApertureSpec, CouplerSpec, GainSpec, IncidentSide, IntensityResponse, LcdMicrolensSpec, LcosSlmSpec, MaskProgram,
  MicrolensArraySpec, MirrorSpec, NonlinearSpec, OpticalElementSpec, PhasePlateSpec, PixelArray, ThinLensSpec, TransmissiveLcdSpec,
} from './types'

const checkFraction = (id: string, name: string, v: number) => {
  if (!(v >= 0 && v <= 1)) throw new Error(`${id}: ${name} must be a power fraction in [0, 1], got ${v}`)
}

/** Mean |t|² over the samples a device covers (or the whole window), i.e. transmission under uniform illumination. */
function meanPower(tr: Float64Array, ti: Float64Array, mask?: Int32Array): number {
  let s = 0
  let n = 0
  for (let i = 0; i < tr.length; i++) {
    if (mask && mask[i] === -1) continue
    s += tr[i] * tr[i] + ti[i] * ti[i]
    n++
  }
  return n ? s / n : 0
}

// ── mirror ───────────────────────────────────────────────────────────────────────────────────

class Mirror implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  constructor(readonly spec: MirrorSpec, private grid: GridSpec) {
    checkFraction(spec.id, 'reflectivity.front', spec.reflectivity.front)
    checkFraction(spec.id, 'reflectivity.back', spec.reflectivity.back)
  }
  get id() { return this.spec.id }
  apply(f: Field, side: IncidentSide) {
    scaleField(f, Math.sqrt(this.spec.reflectivity[side]))
    const { nx, ny } = this.grid
    if (this.spec.parity === 'flip-x') {
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx >> 1; i++) swap(f, j * nx + i, j * nx + nx - 1 - i)
    } else if (this.spec.parity === 'flip-y') {
      for (let j = 0; j < ny >> 1; j++)
        for (let i = 0; i < nx; i++) swap(f, j * nx + i, (ny - 1 - j) * nx + i)
    }
  }
  powerTransmission(side: IncidentSide) { return this.spec.reflectivity[side] }
  state() { return {} }
  resetState() {}
}

function swap(f: Field, a: number, b: number) {
  let t = f.re[a]; f.re[a] = f.re[b]; f.re[b] = t
  t = f.im[a]; f.im[a] = f.im[b]; f.im[b] = t
}

// ── partial coupler ──────────────────────────────────────────────────────────────────────────

class Coupler implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  constructor(readonly spec: CouplerSpec) {
    checkFraction(spec.id, 'retained.front', spec.retained.front)
    checkFraction(spec.id, 'retained.back', spec.retained.back)
    if (spec.inputCoupling !== undefined) checkFraction(spec.id, 'inputCoupling', spec.inputCoupling)
  }
  get id() { return this.spec.id }
  apply(f: Field, side: IncidentSide, ctx: RunContext) {
    const R = this.spec.retained[side]
    if (this.spec.outputTap) ctx.taps.record(this.spec.outputTap, f, Math.sqrt(1 - R))
    scaleField(f, Math.sqrt(R))
    if (this.spec.inputPort && side === 'front') {
      const input = ctx.inputs.take(this.spec.inputPort)
      if (input) addScaled(f, input, Math.sqrt(this.spec.inputCoupling ?? 1 - this.spec.retained.front))
    }
  }
  powerTransmission(side: IncidentSide) { return this.spec.retained[side] }
  state() { return {} }
  resetState() {}
}

// ── pixelated programmable devices ───────────────────────────────────────────────────────────

/** Shared machinery: per-sample complex transmission built from a per-pixel (amplitude, phase) law. */
abstract class PixelDevice implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  protected tr: Float64Array
  protected ti: Float64Array
  protected map: Int32Array
  constructor(readonly spec: OpticalElementSpec, protected env: ElementEnv, pixels: PixelArray) {
    this.map = buildPixelMap(env.grid, pixels)
    this.tr = new Float64Array(this.map.length)
    this.ti = new Float64Array(this.map.length)
    const covered = this.map.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0)
    if (covered === 0) this.warnings.push('device active area does not overlap the simulation window')
    const over = pixels.pitch.x / env.grid.dx
    if (over < 1) this.warnings.push(`pixel pitch (${(pixels.pitch.x * 1e6).toFixed(1)} µm) is finer than the field sampling; pixels are aliased`)
  }
  get id() { return this.spec.id }
  protected fill(pixelAmp: Float64Array, pixelPhase: Float64Array, deadAmp: number) {
    for (let i = 0; i < this.map.length; i++) {
      const p = this.map[i]
      if (p >= 0) {
        this.tr[i] = pixelAmp[p] * Math.cos(pixelPhase[p])
        this.ti[i] = pixelAmp[p] * Math.sin(pixelPhase[p])
      } else {
        this.tr[i] = p === -2 ? deadAmp : 0
        this.ti[i] = 0
      }
    }
  }
  abstract apply(f: Field, side: IncidentSide, ctx: RunContext): void
  abstract powerTransmission(side: IncidentSide): number
  abstract loadProgram(program: MaskProgram): void
  state() { return {} }
  resetState() {}
}

class TransmissiveLcd extends PixelDevice {
  declare readonly spec: TransmissiveLcdSpec
  constructor(spec: TransmissiveLcdSpec, env: ElementEnv) {
    super(spec, env, spec.pixels)
    for (const k of ['clearTransmission', 'polarizerTransmission', 'deadZoneTransmission'] as const) checkFraction(spec.id, k, spec[k])
    for (const s of ['front', 'back'] as const) {
      checkFraction(spec.id, `surfaces.${s}.transmission`, spec.surfaces[s].transmission)
      if (spec.surfaces[s].transmission + spec.surfaces[s].reflection > 1 + 1e-12)
        this.warnings.push(`${s} surface transmission + reflection exceeds 1`)
    }
    this.loadProgram(spec.program)
  }
  loadProgram(program: MaskProgram) {
    const s = this.spec
    const { x, y } = s.pixels.resolution
    const cmd = evaluateProgram(program, x, y, this.env.assets)
    const amp = new Float64Array(cmd.length)
    const ph = new Float64Array(cmd.length)
    const m = s.modulation
    for (let p = 0; p < cmd.length; p++) {
      if (m.kind === 'phase') {
        amp[p] = Math.sqrt(s.clearTransmission)
        ph[p] = achievedPhase(cmd[p], m.phaseRange, m.levels, m.response, s.designWavelength, this.env.wavelength)
      } else {
        const T = m.darkTransmission + (s.clearTransmission - m.darkTransmission) * driveLevel(cmd[p], m.levels)
        amp[p] = Math.sqrt(T)
      }
    }
    this.fill(amp, ph, Math.sqrt(s.deadZoneTransmission))
  }
  apply(f: Field, side: IncidentSide) {
    multiplyComplex(f, this.tr, this.ti)
    scaleField(f, Math.sqrt(this.spec.surfaces[side].transmission * this.spec.polarizerTransmission))
  }
  powerTransmission(side: IncidentSide) {
    return meanPower(this.tr, this.ti, this.map) * this.spec.surfaces[side].transmission * this.spec.polarizerTransmission
  }
}

class LcosSlm extends PixelDevice {
  declare readonly spec: LcosSlmSpec
  constructor(spec: LcosSlmSpec, env: ElementEnv) {
    super(spec, env, spec.pixels)
    checkFraction(spec.id, 'reflectivity', spec.reflectivity)
    checkFraction(spec.id, 'deadZoneReflectivity', spec.deadZoneReflectivity)
    this.loadProgram(spec.program)
  }
  loadProgram(program: MaskProgram) {
    const s = this.spec
    const { x, y } = s.pixels.resolution
    const cmd = evaluateProgram(program, x, y, this.env.assets)
    const aber = s.aberration ? evaluateProgram(s.aberration, x, y, this.env.assets) : null
    const amp = new Float64Array(cmd.length).fill(Math.sqrt(s.reflectivity))
    const ph = new Float64Array(cmd.length)
    for (let p = 0; p < cmd.length; p++)
      ph[p] = achievedPhase(cmd[p], s.phaseRange, s.phaseLevels, s.phaseResponse, s.designWavelength, this.env.wavelength) + (aber ? aber[p] : 0)
    this.fill(amp, ph, Math.sqrt(s.deadZoneReflectivity))
  }
  apply(f: Field, side: IncidentSide) {
    if (side === 'back') {
      // light arriving at the silicon backplane is blocked
      f.re.fill(0)
      f.im.fill(0)
      return
    }
    multiplyComplex(f, this.tr, this.ti)
  }
  powerTransmission(side: IncidentSide) {
    return side === 'back' ? 0 : meanPower(this.tr, this.ti, this.map)
  }
}

class PhasePlate extends PixelDevice {
  declare readonly spec: PhasePlateSpec
  constructor(spec: PhasePlateSpec, env: ElementEnv) {
    super(spec, env, spec.pixels)
    checkFraction(spec.id, 'transmission.front', spec.transmission.front)
    checkFraction(spec.id, 'transmission.back', spec.transmission.back)
    this.loadProgram(spec.program)
  }
  loadProgram(program: MaskProgram) {
    const s = this.spec
    const { x, y } = s.pixels.resolution
    const cmd = evaluateProgram(program, x, y, this.env.assets)
    const scale = s.designWavelength / this.env.wavelength // etched step depth fixed in material
    this.fill(new Float64Array(cmd.length).fill(1), cmd.map((v) => v * scale), 1)
  }
  apply(f: Field, side: IncidentSide) {
    multiplyComplex(f, this.tr, this.ti)
    scaleField(f, Math.sqrt(this.spec.transmission[side]))
  }
  powerTransmission(side: IncidentSide) {
    return meanPower(this.tr, this.ti, this.map) * this.spec.transmission[side]
  }
}

// ── lenses ───────────────────────────────────────────────────────────────────────────────────

class ThinLens implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  private tr: Float64Array
  private ti: Float64Array
  constructor(readonly spec: ThinLensSpec, env: ElementEnv) {
    const { grid, wavelength } = env
    const k = (2 * Math.PI) / wavelength
    const n = grid.nx * grid.ny
    this.tr = new Float64Array(n)
    this.ti = new Float64Array(n)
    const R = spec.apertureDiameter / 2
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x = sampleX(grid, i), y = sampleY(grid, j)
        const r2 = x * x + y * y
        if (r2 > R * R) continue
        const ph = (-k * r2) / (2 * spec.focalLength)
        this.tr[j * grid.nx + i] = Math.cos(ph)
        this.ti[j * grid.nx + i] = Math.sin(ph)
      }
    if ((k * Math.min(R, (grid.nx * grid.dx) / 2) * grid.dx) / Math.abs(spec.focalLength) > Math.PI)
      this.warnings.push('lens phase is under-sampled at the aperture edge (aliasing); increase f or refine the grid')
  }
  get id() { return this.spec.id }
  apply(f: Field, side: IncidentSide) {
    multiplyComplex(f, this.tr, this.ti)
    scaleField(f, Math.sqrt(this.spec.transmission[side]))
  }
  powerTransmission(side: IncidentSide) { return meanPower(this.tr, this.ti) * this.spec.transmission[side] }
  state() { return {} }
  resetState() {}
}

class MicrolensArray implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  private tr: Float64Array
  private ti: Float64Array
  constructor(readonly spec: Omit<MicrolensArraySpec, 'kind' | 'label'> & { kind?: 'microlens-array' }, env: ElementEnv) {
    const { grid, wavelength } = env
    const k = (2 * Math.PI) / wavelength
    const n = grid.nx * grid.ny
    this.tr = new Float64Array(n)
    this.ti = new Float64Array(n)
    const cos = Math.cos(-spec.rotationRad), sin = Math.sin(-spec.rotationRad)
    const R = spec.apertureDiameter / 2
    const halfFx = (spec.pitch.x * Math.sqrt(spec.fillFactor)) / 2
    const halfFy = (spec.pitch.y * Math.sqrt(spec.fillFactor)) / 2
    const focal = (m: number, q: number) => {
      if (!spec.focalLengthSigma) return spec.focalLength
      const rand = mulberry32((spec.seed ^ Math.imul(m, 73856093) ^ Math.imul(q, 19349663)) >>> 0)
      return spec.focalLength * (1 + spec.focalLengthSigma * gaussian(rand))
    }
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x0 = sampleX(grid, i) - spec.offset.x
        const y0 = sampleY(grid, j) - spec.offset.y
        const x = x0 * cos - y0 * sin
        const y = x0 * sin + y0 * cos
        const m = Math.round(x / spec.pitch.x)
        const q = Math.round(y / spec.pitch.y)
        const lx = x - m * spec.pitch.x
        const ly = y - q * spec.pitch.y
        if (Math.abs(lx) > halfFx || Math.abs(ly) > halfFy || lx * lx + ly * ly > R * R) continue
        const ph = (-k * (lx * lx + ly * ly)) / (2 * focal(m, q))
        this.tr[j * grid.nx + i] = Math.cos(ph)
        this.ti[j * grid.nx + i] = Math.sin(ph)
      }
    const rEdge = Math.min(R, halfFx)
    if ((k * rEdge * grid.dx) / Math.abs(spec.focalLength) > Math.PI)
      this.warnings.push('microlens phase is under-sampled at the lenslet edge (aliasing); increase f or refine the grid')
    if (spec.pitch.x < 4 * grid.dx) this.warnings.push('fewer than 4 field samples per lenslet')
  }
  get id() { return this.spec.id }
  apply(f: Field, side: IncidentSide) {
    multiplyComplex(f, this.tr, this.ti)
    scaleField(f, Math.sqrt(this.spec.transmission[side]))
  }
  powerTransmission(side: IncidentSide) { return meanPower(this.tr, this.ti) * this.spec.transmission[side] }
  state() { return {} }
  resetState() {}
}

/** LCD bonded to a microlens array: the two thin elements and the gap between them do not commute. */
class LcdMicrolens implements OpticalElement {
  readonly warnings: string[]
  readonly linear = true
  private lcd: TransmissiveLcd
  private mla: MicrolensArray
  private gap: PropagationKernel
  constructor(readonly spec: LcdMicrolensSpec, env: ElementEnv) {
    this.lcd = new TransmissiveLcd({ ...spec.lcd, kind: 'transmissive-lcd', id: `${spec.id}.lcd` }, env)
    this.mla = new MicrolensArray({ ...spec.microlens, id: `${spec.id}.mla` }, env)
    const medium = resolveMedium(spec.spacingMedium, env.wavelength)
    this.gap = env.kernels.get(env.grid, env.wavelength, spec.spacing, medium)
    this.gapGroupIndex = medium.ng
    this.warnings = [...this.lcd.warnings, ...this.mla.warnings]
  }
  private gapGroupIndex: number
  get id() { return this.spec.id }
  get internalPath() {
    return { length: this.spec.spacing, groupIndex: this.gapGroupIndex }
  }
  apply(f: Field, side: IncidentSide) {
    if (side === 'front') {
      this.lcd.apply(f, side)
      propagate(f, this.gap)
      this.mla.apply(f, side)
    } else {
      this.mla.apply(f, side)
      propagate(f, this.gap)
      this.lcd.apply(f, side)
    }
  }
  loadProgram(program: MaskProgram) { this.lcd.loadProgram(program) }
  powerTransmission(side: IncidentSide) { return this.lcd.powerTransmission(side) * this.mla.powerTransmission(side) }
  state() { return {} }
  resetState() {}
}

// ── aperture ─────────────────────────────────────────────────────────────────────────────────

class Aperture implements OpticalElement {
  readonly linear = true
  readonly warnings: string[] = []
  private w: Float64Array
  constructor(readonly spec: ApertureSpec, grid: GridSpec) {
    this.w = new Float64Array(grid.nx * grid.ny)
    const edge = (d: number) => (spec.softEdge <= 0 ? (d <= 0 ? 1 : 0) : d <= -spec.softEdge ? 1 : d >= 0 ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * d) / spec.softEdge))
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x = sampleX(grid, i), y = sampleY(grid, j)
        // signed distance to the edge (negative inside)
        const d = spec.shape === 'circle'
          ? Math.hypot(x, y) - spec.size.x / 2
          : Math.max(Math.abs(x) - spec.size.x / 2, Math.abs(y) - spec.size.y / 2)
        this.w[j * grid.nx + i] = edge(d)
      }
  }
  get id() { return this.spec.id }
  apply(f: Field) {
    for (let i = 0; i < this.w.length; i++) {
      f.re[i] *= this.w[i]
      f.im[i] *= this.w[i]
    }
  }
  powerTransmission() { return this.w.reduce((s, v) => s + v * v, 0) / this.w.length }
  state() { return {} }
  resetState() {}
}

// ── gain and nonlinearity ────────────────────────────────────────────────────────────────────

class Gain implements OpticalElement {
  readonly warnings: string[] = []
  private rand: () => number
  private lastGain: number
  constructor(readonly spec: GainSpec) {
    if (spec.smallSignalGain < 0) throw new Error(`${spec.id}: smallSignalGain must be ≥ 0`)
    this.rand = mulberry32(spec.noise.kind === 'additive-gaussian' ? spec.noise.seed : 0)
    this.lastGain = spec.smallSignalGain
  }
  get id() { return this.spec.id }
  get linear() { return this.spec.saturation.kind === 'none' && this.spec.noise.kind === 'none' }
  apply(f: Field) {
    const { smallSignalGain: G0, saturation: sat, noise } = this.spec
    if (sat.kind === 'local') {
      let sum = 0
      for (let i = 0; i < f.re.length; i++) {
        const I = f.re[i] * f.re[i] + f.im[i] * f.im[i]
        const g = 1 + (G0 - 1) / (1 + I / sat.saturationIntensity)
        const a = Math.sqrt(Math.max(0, g))
        f.re[i] *= a
        f.im[i] *= a
        sum += g
      }
      this.lastGain = sum / f.re.length
    } else {
      const g = sat.kind === 'global' ? 1 + (G0 - 1) / (1 + meanIntensity(f) / sat.saturationIntensity) : G0
      scaleField(f, Math.sqrt(Math.max(0, g)))
      this.lastGain = g
    }
    if (noise.kind === 'additive-gaussian' && noise.meanIntensity > 0) {
      const s = Math.sqrt(noise.meanIntensity / 2)
      for (let i = 0; i < f.re.length; i++) {
        f.re[i] += s * gaussian(this.rand)
        f.im[i] += s * gaussian(this.rand)
      }
    }
  }
  powerTransmission() { return this.spec.smallSignalGain }
  state() { return { gain: this.lastGain } }
  resetState() {
    this.lastGain = this.spec.smallSignalGain
    this.rand = mulberry32(this.spec.noise.kind === 'additive-gaussian' ? this.spec.noise.seed : 0)
  }
}

function powerGain(r: IntensityResponse, I: number): number {
  return r.kind === 'saturable' ? 1 + r.strength / (1 + I / r.saturationIntensity) : 1
}

function phaseShift(r: IntensityResponse, I: number): number {
  switch (r.kind) {
    case 'kerr': return r.coefficient * I
    case 'saturable-kerr': return (r.maxPhase * I) / (I + r.saturationIntensity)
    default: return 0
  }
}

class Nonlinear implements OpticalElement {
  readonly warnings: string[] = []
  constructor(readonly spec: NonlinearSpec) {
    if (spec.amplitude.kind === 'kerr' || spec.amplitude.kind === 'saturable-kerr')
      this.warnings.push('amplitude response uses a phase-only law; it has no effect')
  }
  get id() { return this.spec.id }
  get linear() { return this.spec.amplitude.kind === 'none' && this.spec.phase.kind === 'none' }
  apply(f: Field) {
    if (this.linear) return
    for (let i = 0; i < f.re.length; i++) {
      const I = f.re[i] * f.re[i] + f.im[i] * f.im[i]
      const a = Math.sqrt(Math.max(0, powerGain(this.spec.amplitude, I)))
      const ph = phaseShift(this.spec.phase, I)
      const c = Math.cos(ph) * a, s = Math.sin(ph) * a
      const r = f.re[i] * c - f.im[i] * s
      f.im[i] = f.re[i] * s + f.im[i] * c
      f.re[i] = r
    }
  }
  powerTransmission() { return powerGain(this.spec.amplitude, 0) }
  state() { return {} }
  resetState() {}
}

// ── registry ─────────────────────────────────────────────────────────────────────────────────

export function buildElement(spec: OpticalElementSpec, env: ElementEnv): OpticalElement {
  switch (spec.kind) {
    case 'mirror': return new Mirror(spec, env.grid)
    case 'coupler': return new Coupler(spec)
    case 'lens': return new ThinLens(spec, env)
    case 'microlens-array': return new MicrolensArray(spec, env)
    case 'aperture': return new Aperture(spec, env.grid)
    case 'lcos-slm': return new LcosSlm(spec, env)
    case 'transmissive-lcd': return new TransmissiveLcd(spec, env)
    case 'lcd-microlens': return new LcdMicrolens(spec, env)
    case 'phase-plate': return new PhasePlate(spec, env)
    case 'gain': return new Gain(spec)
    case 'nonlinear': return new Nonlinear(spec)
  }
}
