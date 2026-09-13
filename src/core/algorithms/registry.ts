import { AlgorithmRegistry } from './interfaces'
import { cellularMemory } from './presets/cellularMemory'
import { hopfieldRelaxation } from './presets/hopfield'
import { staticPattern } from './presets/staticPattern'

/** The built-in demonstrators. New workloads register here (or in their own registry) without touching the solver. */
export function createDefaultRegistry(): AlgorithmRegistry {
  return new AlgorithmRegistry().register(staticPattern).register(cellularMemory).register(hopfieldRelaxation)
}
