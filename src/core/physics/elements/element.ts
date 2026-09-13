import type { AssetResolver } from '../assets'
import type { Field, GridSpec } from '../field/grid'
import type { KernelCache } from '../propagation/angularSpectrum'
import type { IncidentSide, MaskProgram, OpticalElementSpec } from './types'

/** Everything an element needs to precompute its transfer operation. */
export interface ElementEnv {
  grid: GridSpec
  wavelength: number
  kernels: KernelCache
  assets: AssetResolver
}

/** Queued external input, keyed by physical input port id. */
export interface InputSource {
  take(port: string): Field | null
}

/** Receives fields leaving the route (couplers, taps). `amplitude` scales the recorded copy. */
export interface TapSink {
  record(tap: string, field: Field, amplitude: number): void
}

export interface RunContext {
  cycle: number
  inputs: InputSource
  taps: TapSink
}

/**
 * A physical element: a transfer operation on the field for a given incident side, plus metadata for metrics.
 * Elements never know what the field means computationally.
 */
export interface OpticalElement {
  readonly id: string
  readonly spec: OpticalElementSpec
  /** false if the operation depends on the field itself (gain saturation, Kerr, noise) */
  readonly linear: boolean
  readonly warnings: string[]
  apply(field: Field, side: IncidentSide, ctx: RunContext): void
  /** passive small-signal power transmission for uniform illumination of the element from `side` */
  powerTransmission(side: IncidentSide): number
  /** observable internal state, e.g. saturated gain */
  state(): Record<string, number>
  resetState(): void
  /** programmable devices: load a new mask program without rebuilding the route */
  loadProgram?(program: MaskProgram): void
  /** optical path hidden inside a composite element (e.g. an LCD–microlens gap), counted in route timing */
  readonly internalPath?: { length: number; groupIndex: number }
}

export const NULL_CONTEXT: RunContext = {
  cycle: 0,
  inputs: { take: () => null },
  taps: { record: () => {} },
}
