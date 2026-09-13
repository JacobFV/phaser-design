import type { AssetResolver } from './assets'
import type { OpticalElement, RunContext } from './elements/element'
import { buildElement } from './elements/models'
import type { IncidentSide, MaskProgram, OpticalElementSpec } from './elements/types'
import { fft2 } from './field/fft'
import { copyField, createField, sameGrid, type Field, type GridSpec } from './field/grid'
import { resolveMedium, type MediumSpec, type ResolvedMedium } from './media/media'
import { KernelCache, applyKernel, propagate, type PropagationKernel } from './propagation/angularSpectrum'
import { applyBoundary, buildBoundaryWindow, type BoundarySpec } from './propagation/boundary'
import { compileRoute, type Route, type TopologySpec } from './topology/topology'

export const SPEED_OF_LIGHT = 299_792_458

export interface FieldSpec {
  grid: GridSpec
  wavelength: number // vacuum wavelength, m
  boundary: BoundarySpec
}

export type ReadoutStage =
  | { kind: 'element'; element: OpticalElementSpec; side: IncidentSide }
  | { kind: 'propagate'; length: number; medium: MediumSpec }

export type DetectorSpec =
  | { kind: 'near-field' } // intensity in the tap plane (after stages)
  | { kind: 'fourier-plane'; focalLength: number } // ideal lens: detector at its back focal plane

/** Out-of-route readout chain fed by a tap. Readouts never feed back into the cavity. */
export interface ReadoutSpec {
  id: string
  tap: string
  stages: ReadoutStage[]
  detector: DetectorSpec
  bin?: { x: number; y: number } // integrate samples into detector pixels
}

export interface PhysicsConfig {
  field: FieldSpec
  elements: OpticalElementSpec[]
  topology: TopologySpec
  readouts: ReadoutSpec[]
}

export interface DetectorImage {
  id: string
  nx: number
  ny: number
  pixelSize: { x: number; y: number } // m in the detector plane
  intensity: Float64Array // W/m² · (arbitrary scale), row-major
  power: number // Σ I · pixel area
}

type CompiledStep =
  | { kind: 'element'; index: number; element: OpticalElement; side: IncidentSide }
  | { kind: 'propagate'; index: number; kernel: PropagationKernel; medium: ResolvedMedium; length: number }

export interface RouteObserver {
  /** called with the field right after route step `index` (element or propagation) */
  afterStep?(index: number, field: Field): void
  /** called with the angular spectrum at the START of a propagation step, before the kernel is applied */
  propagation?(index: number, spectrum: Field, length: number, medium: ResolvedMedium): void
}

export interface RouteTiming {
  geometricLength: number // m
  opticalPathLength: number // Σ n·L, m
  groupPathLength: number // Σ n_g·L, m
  roundTripTime: number // Σ n_g·L / c, s
  roundTripFrequency: number // 1 / t_rt, Hz
}

/**
 * A physics configuration compiled against a grid: element models, the explicit route, cached kernels and readout
 * chains. `roundTrip` applies one full traversal in place.
 */
export class CompiledSystem {
  readonly grid: GridSpec
  readonly wavelength: number
  readonly route: Route
  readonly elements = new Map<string, OpticalElement>()
  readonly kernels: KernelCache
  private steps: CompiledStep[] = []
  private boundary: Float64Array | null
  private readoutChains: { spec: ReadoutSpec; steps: CompiledStep[]; buffer: Field }[] = []
  private readonly usedIds: Set<string>

  constructor(readonly config: PhysicsConfig, assets: AssetResolver, kernels = new KernelCache()) {
    const { grid, wavelength, boundary } = config.field
    this.grid = grid
    this.wavelength = wavelength
    this.kernels = kernels
    this.boundary = buildBoundaryWindow(grid, boundary)
    const env = { grid, wavelength, kernels, assets }

    const ids = new Set<string>()
    for (const spec of config.elements) {
      if (ids.has(spec.id)) throw new Error(`duplicate element id ${spec.id}`)
      ids.add(spec.id)
      this.elements.set(spec.id, buildElement(spec, env))
    }

    this.route = compileRoute(config.topology)
    this.usedIds = new Set()
    this.steps = this.route.steps.map((s, index) => {
      if (s.kind === 'propagate') {
        const medium = resolveMedium(s.medium, wavelength)
        return { kind: 'propagate', index, kernel: kernels.get(grid, wavelength, s.length, medium), medium, length: s.length }
      }
      const element = this.elements.get(s.elementId)
      if (!element) throw new Error(`route references unknown element ${s.elementId}`)
      this.usedIds.add(s.elementId)
      return { kind: 'element', index, element, side: s.side }
    })

    for (const spec of config.readouts) {
      const steps: CompiledStep[] = spec.stages.map((st, index) => {
        if (st.kind === 'propagate') {
          const medium = resolveMedium(st.medium, wavelength)
          return { kind: 'propagate', index, kernel: kernels.get(grid, wavelength, st.length, medium), medium, length: st.length }
        }
        return { kind: 'element', index, element: buildElement(st.element, env), side: st.side }
      })
      this.readoutChains.push({ spec, steps, buffer: createField(grid) })
    }
  }

  /** One round trip, in place. No allocation on the hot path. */
  roundTrip(field: Field, ctx: RunContext, observer?: RouteObserver): void {
    if (!sameGrid(field.grid, this.grid)) throw new Error('field grid does not match the compiled system')
    for (const step of this.steps) {
      if (step.kind === 'element') {
        step.element.apply(field, step.side, ctx)
      } else {
        fft2(field)
        observer?.propagation?.(step.index, field, step.length, step.medium)
        applyKernel(field, step.kernel, field)
        fft2(field, true)
        applyBoundary(field, this.boundary)
      }
      observer?.afterStep?.(step.index, field)
    }
  }

  /** Push every recorded tap through its readout chain. */
  readouts(taps: ReadonlyMap<string, Field>): DetectorImage[] {
    const out: DetectorImage[] = []
    for (const chain of this.readoutChains) {
      const tap = taps.get(chain.spec.tap)
      if (!tap) continue
      const f = chain.buffer
      copyField(f, tap)
      for (const step of chain.steps) {
        if (step.kind === 'element') step.element.apply(f, step.side, { cycle: 0, inputs: { take: () => null }, taps: { record: () => {} } })
        else propagate(f, step.kernel)
      }
      out.push(detect(f, chain.spec, this.wavelength))
    }
    return out
  }

  timing(): RouteTiming {
    let geo = 0, opl = 0, gpl = 0
    for (const s of this.steps) {
      if (s.kind === 'propagate') {
        geo += s.length
        opl += s.medium.n * s.length
        gpl += s.medium.ng * s.length
      } else if (s.element.internalPath) {
        const p = s.element.internalPath
        geo += p.length
        opl += p.groupIndex * p.length
        gpl += p.groupIndex * p.length
      }
    }
    const t = gpl / SPEED_OF_LIGHT
    return { geometricLength: geo, opticalPathLength: opl, groupPathLength: gpl, roundTripTime: t, roundTripFrequency: 1 / t }
  }

  /** Per-step passive power budget of one round trip (uniform illumination, small signal). */
  powerBudget(): { index: number; label: string; transmission: number }[] {
    return this.steps.map((s) =>
      s.kind === 'propagate'
        ? { index: s.index, label: `propagate ${(s.length * 1e3).toFixed(2)} mm`, transmission: Math.exp(-s.medium.alpha * s.length) }
        : { index: s.index, label: `${s.element.id} (${s.side})`, transmission: s.element.powerTransmission(s.side) },
    )
  }

  isLinear(): boolean {
    return this.steps.every((s) => s.kind === 'propagate' || s.element.linear)
  }

  programmableElements(): string[] {
    return [...this.elements.values()].filter((e) => e.loadProgram).map((e) => e.id)
  }

  loadProgram(elementId: string, program: MaskProgram): void {
    const el = this.elements.get(elementId)
    if (!el?.loadProgram) throw new Error(`element ${elementId} is not programmable`)
    el.loadProgram(program)
  }

  warnings(): string[] {
    const w: string[] = []
    for (const el of this.elements.values()) for (const msg of el.warnings) w.push(`${el.id}: ${msg}`)
    for (const id of this.elements.keys()) if (!this.usedIds.has(id)) w.push(`${id}: defined but not on the route`)
    const { dx, dy } = this.grid
    if (Math.max(Math.PI / dx, Math.PI / dy) > (2 * Math.PI) / this.wavelength)
      w.push('grid spacing is below λ/2: part of the angular spectrum is evanescent')
    return w
  }

  resetElementState(): void {
    for (const el of this.elements.values()) el.resetState()
  }

  elementStates(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {}
    for (const el of this.elements.values()) {
      const s = el.state()
      if (Object.keys(s).length) out[el.id] = s
    }
    return out
  }
}

function detect(f: Field, spec: ReadoutSpec, wavelength: number): DetectorImage {
  const { nx, ny, dx, dy } = f.grid
  let I = new Float64Array(nx * ny)
  let px = { x: dx, y: dy }
  if (spec.detector.kind === 'near-field') {
    for (let i = 0; i < I.length; i++) I[i] = f.re[i] * f.re[i] + f.im[i] * f.im[i]
  } else {
    // ideal Fourier lens: u = λ f · f_x. Normalised so Σ I·(pixel area) equals the tap power.
    const g = createField(f.grid)
    copyField(g, f)
    fft2(g)
    const F = spec.detector.focalLength
    px = { x: (wavelength * F) / (nx * dx), y: (wavelength * F) / (ny * dy) }
    const scale = (dx * dy) / (nx * ny * px.x * px.y)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const s = ((j + ny / 2) % ny) * nx + ((i + nx / 2) % nx)
        I[j * nx + i] = (g.re[s] * g.re[s] + g.im[s] * g.im[s]) * scale
      }
  }
  let outNx = nx, outNy = ny
  if (spec.bin && (spec.bin.x > 1 || spec.bin.y > 1)) {
    const bx = spec.bin.x, by = spec.bin.y
    outNx = Math.floor(nx / bx)
    outNy = Math.floor(ny / by)
    const binned = new Float64Array(outNx * outNy)
    for (let j = 0; j < outNy * by; j++)
      for (let i = 0; i < outNx * bx; i++) binned[Math.floor(j / by) * outNx + Math.floor(i / bx)] += I[j * nx + i] / (bx * by)
    I = binned
    px = { x: px.x * bx, y: px.y * by }
  }
  let power = 0
  for (let i = 0; i < I.length; i++) power += I[i]
  return { id: spec.id, nx: outNx, ny: outNy, pixelSize: px, intensity: I, power: power * px.x * px.y }
}
