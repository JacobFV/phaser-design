import type { ComputationConfig } from '../computation/regions'
import type { PhysicsConfig } from '../physics/system'

export type ParamValue = number | string | boolean | number[]

export interface AlgorithmConfig {
  module: string // registry id of the algorithm module
  params: Record<string, ParamValue>
}

export interface RuntimeConfig {
  seed: number
  historyLength: number // cycles of energy history kept for snapshots
}

/**
 * Everything that determines a simulation result. Serialisable to JSON. Presentation state (colours, camera,
 * animation, layout) is deliberately NOT part of this type.
 */
export interface SimulationConfig {
  version: 1
  name?: string
  physics: PhysicsConfig
  computation: ComputationConfig
  algorithm: AlgorithmConfig
  runtime: RuntimeConfig
}

/**
 * Reset scopes are independent and combinable:
 *  - physical-field: zero the optical field, pending inputs and element state; cycle and time return to 0
 *  - computation:    clear decoded port values / computation histories
 *  - algorithm:      re-initialise the algorithm module state (it may re-inject inputs)
 *  - full:           all of the above
 *  - none:           keep everything
 */
export type ResetScope = 'none' | 'physical-field' | 'computation' | 'algorithm' | 'full'

export interface ConfigChange {
  /** what must be recompiled */
  recompilePhysics: boolean
  recompileComputation: boolean
  reloadAlgorithm: boolean
  /** program-only edits that can be loaded into live devices without recompiling */
  programUpdates: string[]
  /** resets that are REQUIRED for correctness (a requested scope can add to these, never remove them) */
  requiredResets: ResetScope[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Strip mask programs so program-only edits can be detected. */
function withoutPrograms(p: PhysicsConfig): unknown {
  return {
    ...p,
    elements: p.elements.map((e) => {
      if (e.kind === 'lcd-microlens') return { ...e, lcd: { ...e.lcd, program: null } }
      if ('program' in e) return { ...e, program: null }
      return e
    }),
  }
}

export function diffConfig(prev: SimulationConfig, next: SimulationConfig): ConfigChange {
  const change: ConfigChange = { recompilePhysics: false, recompileComputation: false, reloadAlgorithm: false, programUpdates: [], requiredResets: [] }
  const pf = prev.physics.field, nf = next.physics.field

  if (!same(pf.grid, nf.grid) || pf.wavelength !== nf.wavelength) {
    // the field cannot be carried onto a different sampling grid or wavelength
    change.recompilePhysics = true
    change.recompileComputation = true
    change.requiredResets.push('physical-field', 'computation')
  } else if (!same(withoutPrograms(prev.physics), withoutPrograms(next.physics))) {
    // topology, element parameters, media, readouts, boundary: rebuild operators, keep the optical field
    change.recompilePhysics = true
  } else {
    const before = new Map(prev.physics.elements.map((e) => [e.id, e]))
    for (const e of next.physics.elements) if (!same(before.get(e.id), e)) change.programUpdates.push(e.id)
  }

  if (!same(prev.computation, next.computation)) {
    change.recompileComputation = true
    change.requiredResets.push('computation')
  }
  if (!same(prev.algorithm, next.algorithm)) {
    change.reloadAlgorithm = true
    change.requiredResets.push('algorithm')
  }
  return change
}

export function expandScopes(scopes: ResetScope[]): Set<Exclude<ResetScope, 'none' | 'full'>> {
  const out = new Set<Exclude<ResetScope, 'none' | 'full'>>()
  for (const s of scopes) {
    if (s === 'full') { out.add('physical-field'); out.add('computation'); out.add('algorithm') }
    else if (s !== 'none') out.add(s)
  }
  return out
}
