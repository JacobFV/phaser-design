/**
 * Experiment authoring without React or a browser.
 *
 *   npm run example
 *
 * Builds a complete SimulationConfig programmatically, plugs in a custom algorithm module, runs the recurrence,
 * reads computational ports, prints route metrics, characterises state density and exports a reproducible file.
 */
import type { AlgorithmModule } from '../src/core/algorithms/interfaces'
import { createDefaultRegistry } from '../src/core/algorithms/registry'
import { characterize, DEFAULT_THRESHOLDS } from '../src/core/computation/analysis/characterize'
import { AssetStore } from '../src/core/physics/assets'
import type { OpticalElementSpec, TransmissiveLcdSpec } from '../src/core/physics/elements/types'
import { analyticMetrics } from '../src/core/physics/metrics/analytic'
import { linearStack } from '../src/core/physics/topology/builders'
import type { SimulationConfig } from '../src/core/runtime/config'
import { exportExperiment } from '../src/core/runtime/serialize'
import { Simulation } from '../src/core/runtime/simulation'

// ── 1. physics: programmable LCD → fixed optical mixer → programmable LCD, in a linear cavity ──────────
const pitch = 63.5e-6
const pixels = { resolution: { x: 64, y: 64 }, pitch: { x: pitch, y: pitch }, fillFactor: 0.9, offset: { x: 0, y: 0 } }

const lcd = (id: string, seed: number): TransmissiveLcdSpec => ({
  kind: 'transmissive-lcd', id, pixels,
  modulation: { kind: 'phase', phaseRange: 2 * Math.PI, levels: 256, response: { kind: 'linear' } },
  clearTransmission: 0.97,
  surfaces: { front: { transmission: 0.99, reflection: 0.01 }, back: { transmission: 0.98, reflection: 0.02 } }, // deliberately asymmetric
  polarizerTransmission: 0.99,
  deadZoneTransmission: 0,
  switchingTime: 0.01,
  designWavelength: 650e-9,
  program: { kind: 'random', seed, depth: 0.01 },
})

const elements: OpticalElementSpec[] = [
  { kind: 'coupler', id: 'in', retained: { front: 0.95, back: 0.95 }, inputPort: 'in', outputTap: 'tap' },
  lcd('lcdA', 1),
  { kind: 'phase-plate', id: 'mixer', pixels: { ...pixels, fillFactor: 1 }, transmission: { front: 0.99, back: 0.99 }, designWavelength: 650e-9, program: { kind: 'lenslets', groupPx: 16, depth: 0.02 } },
  lcd('lcdB', 2),
  // small-signal gain above the passive loss, so the stored state saturates instead of decaying
  { kind: 'gain', id: 'gain', smallSignalGain: 2, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
  { kind: 'mirror', id: 'end', reflectivity: { front: 0.99, back: 0.99 }, parity: 'none' },
]

const config: SimulationConfig = {
  version: 1,
  name: 'headless example: LCD–mixer–LCD',
  physics: {
    field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.06 } },
    elements,
    topology: linearStack({ elementIds: ['lcdA', 'mixer', 'lcdB'], spacing: 5e-3, medium: { kind: 'gas', gas: 'helium', pressurePa: 101_325, temperatureK: 293.15, attenuationPerM: 0 }, start: ['in'], end: ['gain', 'end'] }),
    readouts: [{ id: 'cam', tap: 'tap', stages: [], detector: { kind: 'near-field' }, bin: { x: 8, y: 8 } }],
  },
  // ── 2. computation: a 4×4 grid of Gaussian cells; write and read ports ─────────────────────────
  computation: {
    regions: [{ id: 'cells', bounds: { kind: 'rect', center: { x: 0, y: 0 }, size: { x: 2.4e-3, y: 2.4e-3 } }, cells: { x: 4, y: 4 }, encoding: { kind: 'blob-mode', sigma: 90e-6 }, role: 'memory' }],
    ports: [
      { id: 'write', direction: 'input', region: 'cells', physicalPort: 'in', normalization: { kind: 'none' } },
      { id: 'read', direction: 'output', region: 'cells', source: { kind: 'cavity' } },
    ],
  },
  // ── 3. algorithm: a custom module registered below ─────────────────────────────────────────────
  algorithm: { module: 'checkerboard-logger', params: { every: 25 } },
  runtime: { seed: 1, historyLength: 1000 },
}

/** A tiny custom workload: writes a checkerboard once and logs the contrast between on and off cells. */
const checkerboardLogger: AlgorithmModule<{ log: number[] }> = {
  id: 'checkerboard-logger',
  name: 'Checkerboard logger',
  description: 'Example plug-in built outside the core.',
  params: [{ key: 'every', label: 'log every N cycles', kind: 'integer', default: 25, min: 1 }],
  requirements: () => ({ regions: ['cells'], ports: [{ id: 'write', direction: 'input' }, { id: 'read', direction: 'output' }] }),
  cadence: (p) => Number(p.every),
  init(_p, ctx) {
    const { cells } = ctx.region('cells')
    ctx.writePort('write', Array.from({ length: cells.x * cells.y }, (_, i) => ((i % cells.x) + Math.floor(i / cells.x)) % 2), 'pulse')
    return { log: [] }
  },
  update(s, _p, ctx) {
    const v = ctx.readPort('read')
    const on = v.filter((_, i) => i % 2 === (Math.floor(i / 4) % 2 === 0 ? 0 : 1))
    const off = v.filter((_, i) => i % 2 !== (Math.floor(i / 4) % 2 === 0 ? 0 : 1))
    const mean = (a: Float64Array) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
    return { log: [...s.log, mean(off) > 0 ? mean(on) / mean(off) : Infinity] }
  },
  readout: (s) => ({ metrics: { lastContrast: s.log[s.log.length - 1] ?? NaN }, vectors: { contrast: s.log } }),
  status: (s) => ({ phase: `${s.log.length} samples`, done: false }),
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const assets = new AssetStore()
const registry = createDefaultRegistry().register(checkerboardLogger)
const sim = new Simulation(config, { assets, algorithms: registry })

const t0 = performance.now()
sim.step(200)
const snap = sim.snapshot()
console.log(`ran ${snap.cycle} round trips in ${(performance.now() - t0).toFixed(0)} ms (physical time ${(snap.time * 1e9).toFixed(3)} ns)`)
console.log('algorithm:', snap.algorithm.status.phase, snap.algorithm.readout.metrics, snap.algorithm.error ?? '')
console.log('read port (power per Gaussian cell, W):', Array.from(sim.readPort('read'), (v) => v.toExponential(2)).join(' '))
console.log(`mean intensity ${snap.physics.meanIntensity.toExponential(3)} W/m², gain now ${snap.physics.elementStates.gain?.gain.toFixed(3)}`)

// mask update on the live device: the optical state and time are preserved
sim.setProgram('lcdA', { kind: 'grating', periodPx: 8, depth: 0.25, orientation: 'x' })
sim.step(50)
console.log(`after live program change: cycle ${sim.cycle}, mean intensity ${sim.snapshot().physics.meanIntensity.toExponential(3)}`)

console.log('\nroute metrics:')
for (const m of analyticMetrics(sim.system).filter((m) => ['roundTripFrequency', 'passiveRetention', 'loopGain', 'effectiveModes', 'modulatorPixels'].includes(m.key)))
  console.log(`  [${m.kind}] ${m.label}: ${m.value.toPrecision(4)} ${m.unit}`)

console.log('\ncharacterising blob stability (finite horizon)…')
const result = characterize(config.physics, assets, {
  sigmas: [30e-6, 60e-6, 120e-6, 240e-6],
  separations: [150e-6, 300e-6, 600e-6, 1200e-6],
  horizons: [1, 10, 50],
  thresholds: { ...DEFAULT_THRESHOLDS, minCorrelation: 0.8, maxLeakage: 0.2, maxCrosstalk: 0.1, maxWidthDriftPerCycle: 0.01, maxCentroidDriftPerCycle: 0.01 },
})
const µm = (v: number | null) => (v === null ? '–' : `${(v * 1e6).toFixed(0)} µm`)
console.log(`  min stable σ @ ${result.horizonCycles} cycles: ${µm(result.minStableSigma)}; stable states/mm²: ${result.stable.statesPerMm2?.toFixed(2) ?? '–'}`)
for (const d of result.transient) console.log(`  horizon ${d.horizon}: min σ ${µm(d.minSigma)}, min separation ${µm(d.minSeparation)}, states/mm² ${d.statesPerMm2?.toFixed(2) ?? '–'}`)
for (const t of result.trials) console.log(`  σ ${µm(t.sigma)}: ${t.horizons.map((h) => `@${h.horizon} corr ${h.correlation.toFixed(2)} σ×${h.sigmaRatio.toFixed(2)}`).join(', ')}${t.stable ? ' · stable' : ` · ${t.reasons.join('; ')}`}`)
console.log(`  [${result.asymptotic.kind}] ${result.asymptotic.note}`)

const json = exportExperiment(sim.config, assets, { embedAssets: true })
console.log(`\nexported reproducible experiment (${json.length} bytes)`)
