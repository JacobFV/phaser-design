// Shared fixtures. Kept out of *.test.ts files so importing them never re-runs another suite.
import type { OpticalElementSpec, TransmissiveLcdSpec } from '../src/core/physics/elements/types'
import type { SimulationConfig } from '../src/core/runtime/config'
import { LCD_PIXELS } from './fixtures/legacy/params'

/**
 * Small linear cavity for fast runtime tests: coupler (input port "in") → LCD → end mirror, 32×32 periodic vacuum.
 * Linear (no gain) so superposition checks are exact.
 */
export function tinyConfig(extraElements: OpticalElementSpec[] = []): SimulationConfig {
  return {
    version: 1,
    physics: {
      field: { grid: { nx: 32, ny: 32, dx: 20e-6, dy: 20e-6 }, wavelength: 650e-9, boundary: { kind: 'periodic' } },
      elements: [
        { kind: 'coupler', id: 'in', retained: { front: 0.9, back: 0.9 }, inputPort: 'in', outputTap: 'out' },
        lcd({ id: 'lcd', program: { kind: 'random', seed: 2, depth: 0.3 } }),
        { kind: 'mirror', id: 'end', reflectivity: { front: 1, back: 1 }, parity: 'none' },
        ...extraElements,
      ],
      topology: {
        kind: 'linear-reciprocal', length: 0.02, medium: { kind: 'vacuum' },
        start: { elementIds: ['in'] }, end: { elementIds: ['end'] }, items: [{ elementId: 'lcd', position: 0.01 }],
      },
      readouts: [{ id: 'det', tap: 'out', stages: [], detector: { kind: 'near-field' } }],
    },
    computation: {
      regions: [{ id: 'all', bounds: { kind: 'rect', center: { x: 0, y: 0 }, size: { x: 640e-6, y: 640e-6 } }, cells: { x: 8, y: 8 }, encoding: { kind: 'amplitude' } }],
      ports: [
        { id: 'x', direction: 'input', region: 'all', physicalPort: 'in', normalization: { kind: 'none' } },
        { id: 'y', direction: 'output', region: 'all', source: { kind: 'cavity' } },
      ],
    },
    algorithm: { module: 'none', params: {} },
    runtime: { seed: 1, historyLength: 256 },
  }
}

/**
 * Identity "cavity": the route is a single lossless coupler with full input coupling and no propagation, so any
 * written state is held exactly. Used to test algorithm logic independently of optical imperfections.
 */
export function identityConfig(algorithm: SimulationConfig['algorithm'], cells = { x: 4, y: 4 }): SimulationConfig {
  const base = tinyConfig()
  return {
    ...base,
    physics: {
      ...base.physics,
      elements: [{ kind: 'coupler', id: 'in', retained: { front: 1, back: 1 }, inputCoupling: 1, inputPort: 'in' }],
      topology: { kind: 'custom', route: [{ kind: 'element', elementId: 'in', side: 'front' }] },
      readouts: [],
    },
    computation: {
      regions: [{ id: 'cells', bounds: { kind: 'rect', center: { x: 0, y: 0 }, size: { x: 640e-6, y: 640e-6 } }, cells, encoding: { kind: 'blob-mode', sigma: 25e-6 } }],
      ports: [
        { id: 'write', direction: 'input', region: 'cells', physicalPort: 'in', normalization: { kind: 'none' } },
        { id: 'read', direction: 'output', region: 'cells', source: { kind: 'cavity' } },
      ],
    },
    algorithm,
  }
}

export const pattern = (seed: number) => Array.from({ length: 64 }, (_, i) => ((i * 7 + seed * 13) % 11) / 10)

/** 64×64 ring used as the legacy input pattern. */
export function legacyRing(): Float32Array {
  const L = LCD_PIXELS
  const amp = new Float32Array(L * L)
  for (let y = 0; y < L; y++)
    for (let x = 0; x < L; x++) amp[y * L + x] = Math.abs(Math.hypot(x - 32, y - 32) - 20) < 2.5 ? 1 : 0
  return amp
}

/** Ideal 16×16 phase LCD with 40 µm pixels (fills a 32 × 20 µm window). */
export const lcd = (over: Partial<TransmissiveLcdSpec> = {}): TransmissiveLcdSpec => ({
  kind: 'transmissive-lcd',
  id: 'lcd',
  pixels: { resolution: { x: 16, y: 16 }, pitch: { x: 40e-6, y: 40e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } },
  modulation: { kind: 'phase', phaseRange: 2 * Math.PI, levels: 0, response: { kind: 'linear' } },
  clearTransmission: 1,
  surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
  polarizerTransmission: 1,
  deadZoneTransmission: 0,
  switchingTime: 0.01,
  designWavelength: 650e-9,
  program: { kind: 'zero' },
  ...over,
})
