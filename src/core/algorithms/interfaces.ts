import type { AssetRef, MaskProgram, Vec2 } from '../computation'

/**
 * Algorithm modules are workloads expressed over the computational abstraction: they declare which regions and ports
 * they need, write inputs, read outputs, and (slowly) load mask programs. They never touch FFT buffers or elements.
 *
 * Execution model: programs stay fixed while the optical state evolves for `cadence` cycles (10⁴–10⁶ in a real device);
 * `update` runs between those blocks inside the worker, never from React.
 */
export type ParamValue = number | string | boolean | number[]

export type ParamDescriptor =
  | { key: string; label: string; kind: 'number'; default: number; min?: number; max?: number; step?: number; unit?: string }
  | { key: string; label: string; kind: 'integer'; default: number; min?: number; max?: number }
  | { key: string; label: string; kind: 'boolean'; default: boolean }
  | { key: string; label: string; kind: 'select'; default: string; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'text'; default: string }

export type Params = Record<string, ParamValue>

export interface AlgorithmRequirements {
  regions: string[]
  ports: { id: string; direction: 'input' | 'output' }[]
  /** minimum number of programmable elements the module drives */
  programmable?: number
}

export interface RegionInfo {
  id: string
  role?: string
  cells: { x: number; y: number }
  dims: number
  centers: Vec2[]
  encoding: string
}

/** The only view of the simulation an algorithm gets. */
export interface AlgorithmContext {
  readonly cycle: number
  readonly roundTripTime: number // s, from the physical route
  readonly window: { width: number; height: number } // transverse extent of the simulated field, m
  region(id: string): RegionInfo
  /** id of the region a port is bound to (ports are declared by the computation config, not the module) */
  portRegion(portId: string): string
  readPort(id: string): Float64Array
  writePort(id: string, values: ArrayLike<number>, mode: 'pulse' | 'continuous'): void
  stopPort(id: string): void
  programmableElements(): { id: string; resolution: { x: number; y: number } }[]
  loadProgram(elementId: string, program: MaskProgram): void
  putAsset(id: string, width: number, height: number, data: ArrayLike<number>): AssetRef
  /** ask the runtime to clear the optical field before the next cycle (e.g. to overwrite rather than superpose state) */
  requestFieldReset(): void
}

/** JSON-serialisable semantic readout. */
export interface AlgorithmReadout {
  metrics: Record<string, number>
  vectors?: Record<string, number[]>
  grid?: { width: number; height: number; values: number[]; label: string }
  text?: string
}

export interface AlgorithmStatus {
  phase: string
  done: boolean
  message?: string
}

export interface AlgorithmModule<S = unknown> {
  id: string
  name: string
  description: string
  params: ParamDescriptor[]
  requirements(params: Params): AlgorithmRequirements
  /** cycles between `update` calls (≥ 1) */
  cadence(params: Params): number
  init(params: Params, ctx: AlgorithmContext): S
  /** runs before the round trip of every cycle that is a multiple of `cadence` */
  update(state: S, params: Params, ctx: AlgorithmContext): S
  readout(state: S, params: Params, ctx: AlgorithmContext): AlgorithmReadout
  status(state: S, params: Params): AlgorithmStatus
}

export function defaultParams(m: AlgorithmModule): Params {
  return Object.fromEntries(m.params.map((p) => [p.key, p.default]))
}

export function resolveParams(m: AlgorithmModule, given: Params): Params {
  return { ...defaultParams(m), ...given }
}

export class AlgorithmRegistry {
  private modules = new Map<string, AlgorithmModule<unknown>>()
  register<S>(m: AlgorithmModule<S>): this {
    this.modules.set(m.id, m as AlgorithmModule<unknown>)
    return this
  }
  get(id: string): AlgorithmModule<unknown> {
    const m = this.modules.get(id)
    if (!m) throw new Error(`unknown algorithm module ${id}`)
    return m
  }
  list(): AlgorithmModule<unknown>[] {
    return [...this.modules.values()]
  }
}
