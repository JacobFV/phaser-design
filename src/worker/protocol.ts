import type { CharacterizationRequest, CharacterizationResult } from '../core/computation/analysis/characterize'
import type { AssetRef, MaskProgram } from '../core/physics/elements/types'
import type { Metric } from '../core/physics/metrics/analytic'
import type { ConfigChange, ResetScope, SimulationConfig } from '../core/runtime/config'
import type { ObservationRequest } from '../core/runtime/observation'
import type { SimulationSnapshot } from '../core/runtime/snapshots'

/** Messages to the simulation worker. Every message carries the runtime state forward; nothing here renders. */
export type ToWorker =
  | { type: 'load'; config: SimulationConfig; assets: { ref: AssetRef; data: Float64Array }[] }
  | { type: 'configure'; config: SimulationConfig; reset?: ResetScope[] }
  | { type: 'step'; count: number; observe: ObservationRequest; requestId: number }
  | { type: 'observe'; observe: ObservationRequest; requestId: number }
  | { type: 'reset'; scopes: ResetScope[] }
  | { type: 'set-program'; elementId: string; program: MaskProgram; preserveField: boolean }
  | { type: 'write-port'; port: string; values: number[]; mode: 'pulse' | 'continuous' }
  | { type: 'put-asset'; id: string; width: number; height: number; data: Float64Array }
  | { type: 'characterize'; jobId: number; request: CharacterizationRequest }

export type FromWorker =
  | { type: 'snapshot'; requestId: number | null; snapshot: SimulationSnapshot; config: SimulationConfig }
  | { type: 'configured'; applied: ResetScope[]; change: ConfigChange }
  | { type: 'metrics'; metrics: Metric[] }
  | { type: 'asset'; ref: AssetRef }
  | { type: 'characterize-progress'; jobId: number; done: number; total: number }
  | { type: 'characterize-result'; jobId: number; result: CharacterizationResult }
  | { type: 'error'; message: string; context: string }
