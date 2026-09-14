import { AlgorithmRegistry, resolveParams, type AlgorithmContext, type AlgorithmModule, type AlgorithmReadout, type AlgorithmStatus } from '../algorithms/interfaces'
import { CompiledComputation } from '../computation/regions'
import { AssetStore } from '../physics/assets'
import type { RunContext, TapSink } from '../physics/elements/element'
import { isProgrammable, withProgram, type MaskProgram } from '../physics/elements/types'
import { addScaled, cloneField, copyField, createField, fieldPower, meanIntensity, packField, sameGrid, scaleField, zeroField, type Field, type GridSpec } from '../physics/field/grid'
import { KernelCache } from '../physics/propagation/angularSpectrum'
import { CompiledSystem } from '../physics/system'
import { diffConfig, expandScopes, type ConfigChange, type ResetScope, type SimulationConfig } from './config'
import { RouteRecorder, type ObservationRequest, type Projection, type SideView } from './observation'
import type { SimulationSnapshot } from './snapshots'

export type InjectionMode = 'pulse' | 'continuous'

/** External light waiting at physical input ports. Pulses are consumed once; continuous inputs persist until stopped. */
class InputQueue {
  private pulses = new Map<string, Field>()
  private continuous = new Map<string, Field>()
  private combined = new Map<string, Field>()
  constructor(private grid: GridSpec) {}

  add(port: string, field: Field, mode: InjectionMode) {
    if (mode === 'continuous') {
      this.continuous.set(port, cloneField(field))
      return
    }
    const existing = this.pulses.get(port)
    if (existing) addScaled(existing, field, 1)
    else this.pulses.set(port, cloneField(field))
  }

  stop(port: string) {
    this.continuous.delete(port)
  }

  take(port: string): Field | null {
    const p = this.pulses.get(port)
    const c = this.continuous.get(port)
    if (!p && !c) return null
    this.pulses.delete(port)
    if (p && !c) return p
    if (c && !p) return c
    let buf = this.combined.get(port)
    if (!buf) this.combined.set(port, (buf = createField(this.grid)))
    copyField(buf, c!)
    addScaled(buf, p!, 1)
    return buf
  }

  clear() {
    this.pulses.clear()
    this.continuous.clear()
  }

  active(): { port: string; mode: InjectionMode }[] {
    return [
      ...[...this.pulses.keys()].map((port) => ({ port, mode: 'pulse' as const })),
      ...[...this.continuous.keys()].map((port) => ({ port, mode: 'continuous' as const })),
    ]
  }
}

export interface SimulationOptions {
  assets?: AssetStore
  algorithms?: AlgorithmRegistry
}

export interface ConfigureResult {
  change: ConfigChange
  applied: ResetScope[]
}

/**
 * Headless runtime: owns the configuration and the physical, computational and algorithmic runtime state, and
 * coordinates the three layers. It has no knowledge of rendering.
 */
export class Simulation {
  readonly assets: AssetStore
  readonly algorithms: AlgorithmRegistry
  private cfg: SimulationConfig
  private kernels = new KernelCache()
  private sys!: CompiledSystem
  private comp!: CompiledComputation
  private field!: Field
  private inputs!: InputQueue
  private tapBuffers = new Map<string, Field>()
  private energy: number[] = []
  private _cycle = 0
  private _time = 0
  private epoch = 0
  private module: AlgorithmModule | null = null
  private algState: unknown = null
  private algError: string | undefined
  private fieldResetRequested = false
  private recorder: RouteRecorder | null = null
  private lastObservation: ObservationRequest = {}
  private lastStepMs = 0

  constructor(config: SimulationConfig, opts: SimulationOptions = {}) {
    this.assets = opts.assets ?? new AssetStore()
    this.algorithms = opts.algorithms ?? new AlgorithmRegistry()
    this.cfg = structuredClone(config)
    this.compilePhysics(true)
    this.compileComputation()
    this.initAlgorithm()
  }

  get config(): Readonly<SimulationConfig> { return this.cfg }
  get cycle() { return this._cycle }
  get time() { return this._time }
  get system(): CompiledSystem { return this.sys }
  get computation(): CompiledComputation { return this.comp }
  /** Read-only view of the circulating field at the route start. */
  get currentField(): Field { return this.field }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────

  private compilePhysics(newField: boolean) {
    this.sys = new CompiledSystem(this.cfg.physics, this.assets, this.kernels)
    const grid = this.sys.grid
    if (newField || !this.field || !sameGrid(this.field.grid, grid)) {
      this.field = createField(grid)
      this.inputs = new InputQueue(grid)
      this.tapBuffers.clear()
    }
  }

  private compileComputation() {
    this.comp = new CompiledComputation(this.cfg.computation, this.sys.grid)
  }

  private initAlgorithm() {
    this.algError = undefined
    const id = this.cfg.algorithm.module
    if (id === 'none') {
      this.module = null
      this.algState = null
      return
    }
    try {
      this.module = this.algorithms.get(id)
      const params = resolveParams(this.module, this.cfg.algorithm.params)
      const req = this.module.requirements(params)
      for (const r of req.regions) if (!this.comp.regions.has(r)) throw new Error(`algorithm ${id} needs region "${r}"`)
      for (const p of req.ports) {
        const port = this.comp.ports.get(p.id)
        if (!port) throw new Error(`algorithm ${id} needs ${p.direction} port "${p.id}"`)
        if (port.direction !== p.direction) throw new Error(`port "${p.id}" must be an ${p.direction} port`)
      }
      if (req.programmable && this.sys.programmableElements().length < req.programmable)
        throw new Error(`algorithm ${id} needs ${req.programmable} programmable element(s)`)
      this.algState = this.module.init(params, this.context())
    } catch (e) {
      this.algError = (e as Error).message
      this.algState = null
    }
  }

  /**
   * Apply a new configuration. Only what changed is rebuilt; resets happen only when required for correctness or
   * explicitly requested. Returns the resets actually applied.
   */
  configure(next: SimulationConfig, opts: { reset?: ResetScope[] } = {}): ConfigureResult {
    const change = diffConfig(this.cfg, next)
    this.cfg = structuredClone(next)
    if (change.recompilePhysics) this.compilePhysics(false)
    else for (const id of change.programUpdates) {
      const spec = this.cfg.physics.elements.find((e) => e.id === id)
      if (spec && isProgrammable(spec)) this.sys.loadProgram(id, spec.kind === 'lcd-microlens' ? spec.lcd.program : spec.program)
    }
    if (change.recompileComputation) this.compileComputation()
    const applied = [...new Set([...change.requiredResets, ...(opts.reset ?? [])])].filter((s) => s !== 'none')
    this.reset(applied)
    return { change, applied }
  }

  reset(scopes: ResetScope | ResetScope[]) {
    const set = expandScopes(Array.isArray(scopes) ? scopes : [scopes])
    if (set.has('physical-field')) {
      zeroField(this.field)
      this.inputs.clear()
      this.tapBuffers.clear()
      this.energy = []
      this._cycle = 0
      this._time = 0
      this.sys.resetElementState()
      this.recorder = null // observations of the old field are no longer valid
      this.lastObservation = {}
      this.epoch++
    }
    if (set.has('algorithm')) this.initAlgorithm()
  }

  // ── stepping ─────────────────────────────────────────────────────────────────────────────────

  private tapSink: TapSink = {
    record: (tap, f, amplitude) => {
      let buf = this.tapBuffers.get(tap)
      if (!buf) this.tapBuffers.set(tap, (buf = createField(f.grid)))
      copyField(buf, f)
      scaleField(buf, amplitude)
    },
  }

  /** Run `count` round trips. Observation (if any) is recorded during the last one and never alters the result. */
  step(count = 1, observe: ObservationRequest = {}): void {
    const t0 = performance.now()
    const tRt = this.sys.timing().roundTripTime
    const history = this.cfg.runtime.historyLength
    for (let n = 0; n < count; n++) {
      const last = n === count - 1
      if (this.module && this.algState !== null && this._cycle > 0) {
        const params = resolveParams(this.module, this.cfg.algorithm.params)
        if (this._cycle % Math.max(1, this.module.cadence(params)) === 0) {
          try {
            this.algState = this.module.update(this.algState, params, this.context())
          } catch (e) {
            this.algError = (e as Error).message
          }
        }
      }
      if (this.fieldResetRequested) {
        zeroField(this.field)
        this.fieldResetRequested = false
      }
      const ctx: RunContext = { cycle: this._cycle, inputs: this.inputs, taps: this.tapSink }
      this.recorder = last ? new RouteRecorder(this.sys, observe) : null
      this.sys.roundTrip(this.field, ctx, this.recorder ?? undefined)
      this.energy.push(meanIntensity(this.field))
      if (this.energy.length > history) this.energy.splice(0, this.energy.length - history)
      this._cycle++
      this._time += tRt
    }
    this.lastObservation = observe
    this.lastStepMs = performance.now() - t0
  }

  // ── injection, ports and programs ────────────────────────────────────────────────────────────

  /** Physics-level injection of a raw field at a coupler input port. Never touches the circulating state. */
  injectField(physicalPort: string, field: Field, mode: InjectionMode): void {
    if (!sameGrid(field.grid, this.sys.grid)) throw new Error('injected field grid does not match the simulation grid')
    this.inputs.add(physicalPort, field, mode)
  }

  stopInjection(physicalPort: string): void {
    this.inputs.stop(physicalPort)
  }

  writePort(portId: string, values: ArrayLike<number>, mode: InjectionMode): void {
    const port = this.comp.port(portId)
    if (port.direction !== 'input') throw new Error(`port ${portId} is not an input`)
    const f = createField(this.sys.grid)
    this.comp.region(port.region).encode(values, f)
    if (port.normalization.kind === 'mean-intensity') {
      const m = meanIntensity(f)
      if (m > 0) scaleField(f, Math.sqrt(port.normalization.value / m))
    }
    this.inputs.add(port.physicalPort, f, mode)
  }

  stopPort(portId: string): void {
    const port = this.comp.port(portId)
    if (port.direction === 'input') this.inputs.stop(port.physicalPort)
  }

  readPort(portId: string): Float64Array {
    const port = this.comp.port(portId)
    if (port.direction !== 'output') throw new Error(`port ${portId} is not an output`)
    const region = this.comp.region(port.region)
    switch (port.source.kind) {
      case 'cavity':
        return region.decodeField(this.field)
      case 'tap': {
        const tap = this.tapBuffers.get(port.source.tap)
        return tap ? region.decodeField(tap) : new Float64Array(region.dims)
      }
      case 'readout': {
        const id = port.source.readout
        const img = this.sys.readouts(this.tapBuffers).find((r) => r.id === id)
        return img ? region.decodeImage(img) : new Float64Array(region.dims)
      }
    }
  }

  /** Load a mask program into a live device. With preserveField (default) time and optical state continue untouched. */
  setProgram(elementId: string, program: MaskProgram, opts: { preserveField?: boolean } = {}): void {
    const idx = this.cfg.physics.elements.findIndex((e) => e.id === elementId)
    const spec = this.cfg.physics.elements[idx]
    if (!spec || !isProgrammable(spec)) throw new Error(`element ${elementId} is not programmable`)
    this.sys.loadProgram(elementId, program)
    this.cfg.physics.elements[idx] = withProgram(spec, program)
    if (opts.preserveField === false) this.reset('physical-field')
  }

  // ── algorithm context ────────────────────────────────────────────────────────────────────────

  private context(): AlgorithmContext {
    const grid = this.sys.grid
    return {
      cycle: this._cycle,
      roundTripTime: this.sys.timing().roundTripTime,
      window: { width: grid.nx * grid.dx, height: grid.ny * grid.dy },
      region: (id) => {
        const r = this.comp.region(id)
        return { id, role: r.spec.role, cells: r.spec.cells, dims: r.dims, centers: r.cells.map((c) => c.center), encoding: r.spec.encoding.kind }
      },
      portRegion: (id) => this.comp.port(id).region,
      readPort: (id) => this.readPort(id),
      writePort: (id, values, mode) => this.writePort(id, values, mode),
      stopPort: (id) => this.stopPort(id),
      programmableElements: () =>
        this.cfg.physics.elements.filter(isProgrammable).map((e) => {
          const px = e.kind === 'lcd-microlens' ? e.lcd.pixels : e.pixels
          return { id: e.id, resolution: px.resolution }
        }),
      loadProgram: (id, program) => this.setProgram(id, program),
      putAsset: (id, w, h, data) => this.assets.put(id, w, h, data),
      requestFieldReset: () => { this.fieldResetRequested = true },
    }
  }

  // ── snapshots ────────────────────────────────────────────────────────────────────────────────

  snapshot(): SimulationSnapshot {
    const obs = this.lastObservation
    const rec = this.recorder
    // The recorder outlives a snapshot (configure / observe re-snapshot the same round trip), and the worker transfers
    // snapshot buffers to the UI. Copy so a second snapshot never hands out a buffer that was already detached.
    const copyProjection = (p: Projection): Projection => ({ I: p.I.slice(), re: p.re.slice(), im: p.im.slice() })
    const stepFields: Record<number, Float32Array> = {}
    if (rec) for (const [k, v] of Object.entries(rec.stepFields)) stepFields[Number(k)] = v.slice()
    const sideView: SideView | undefined = rec?.sideView && {
      nx: rec.sideView.nx,
      segments: rec.sideView.segments.map((s) => ({ stepIndex: s.stepIndex, rows: s.rows.map(copyProjection) })),
      after: Object.fromEntries(Object.entries(rec.sideView.after).map(([k, p]) => [k, copyProjection(p)])),
    }
    const taps: Record<string, Float32Array> = {}
    if (obs.taps) for (const [id, f] of this.tapBuffers) taps[id] = packField(f)
    const readouts = obs.readouts
      ? this.sys.readouts(this.tapBuffers).map((r) => ({ id: r.id, nx: r.nx, ny: r.ny, pixelSize: r.pixelSize, intensity: Float32Array.from(r.intensity), power: r.power }))
      : []

    const ports: Record<string, number[]> = {}
    const regionPower: Record<string, number> = {}
    for (const p of this.comp.ports.values()) {
      if (p.direction !== 'output') continue
      try { ports[p.id] = Array.from(this.readPort(p.id)) } catch { /* reported via warnings */ }
    }
    for (const [id, r] of this.comp.regions) regionPower[id] = r.powerFraction(this.field)

    let readout: AlgorithmReadout = { metrics: {} }
    let status: AlgorithmStatus = { phase: this.module ? 'idle' : 'no algorithm', done: false }
    if (this.module && this.algState !== null) {
      const params = resolveParams(this.module, this.cfg.algorithm.params)
      try {
        readout = this.module.readout(this.algState, params, this.context())
        status = this.module.status(this.algState, params)
      } catch (e) {
        this.algError = (e as Error).message
      }
    }

    return {
      epoch: this.epoch,
      cycle: this._cycle,
      time: this._time,
      stepMs: this.lastStepMs,
      physics: {
        grid: this.sys.grid,
        wavelength: this.sys.wavelength,
        meanIntensity: meanIntensity(this.field),
        power: fieldPower(this.field),
        energyHistory: Float64Array.from(this.energy),
        timing: this.sys.timing(),
        route: this.sys.route,
        budget: this.sys.powerBudget(),
        elementStates: this.sys.elementStates(),
        warnings: this.sys.warnings(),
        field: obs.captureField ? packField(this.field) : undefined,
        stepFields,
        taps,
        readouts,
        sideView,
        probe: rec?.probe?.slice(),
      },
      computation: { ports, regionPower, warnings: this.comp.warnings },
      algorithm: { module: this.cfg.algorithm.module, status, readout, error: this.algError },
    }
  }

  /** Inputs currently queued at physical ports (pulses not yet consumed, continuous sources). */
  pendingInputs() {
    return this.inputs.active()
  }
}
