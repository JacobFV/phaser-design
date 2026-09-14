import type { ComputationConfig } from '../computation/regions'
import type { LcdMicrolensSpec, OpticalElementSpec, PhaseResponse, PixelArray, TransmissiveLcdSpec } from '../physics/elements/types'
import type { MediumSpec } from '../physics/media/media'
import { rectangularRing } from '../physics/topology/builders'
import type { SimulationConfig } from './config'

/**
 * Presets are ordinary serialisable configurations. The solver has no idea which preset produced a config.
 */
const TAU = 2 * Math.PI
const AIR: MediumSpec = { kind: 'air', pressurePa: 101_325, temperatureK: 288.15, attenuationPerM: -Math.log(0.998) }
const linear: PhaseResponse = { kind: 'linear' }

const pixels = (res: number, pitch: number, fillFactor = 1): PixelArray => ({
  resolution: { x: res, y: res }, pitch: { x: pitch, y: pitch }, fillFactor, offset: { x: 0, y: 0 },
})

type LcdParams = Omit<TransmissiveLcdSpec, 'kind' | 'id' | 'label'>

const idealLcd = (px: PixelArray, program: TransmissiveLcdSpec['program'], clear = 1): LcdParams => ({
  pixels: px,
  modulation: { kind: 'phase', phaseRange: TAU, levels: 0, response: linear },
  clearTransmission: clear,
  surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
  polarizerTransmission: 1,
  deadZoneTransmission: 0,
  switchingTime: 0.016,
  designWavelength: 650e-9,
  program,
})

/** Input/output over the device aperture, a coarse blob-cell region for memory workloads, and a detector port. */
function standardComputation(aperture: number, readout?: string): ComputationConfig {
  const rect = (side: number) => ({ kind: 'rect' as const, center: { x: 0, y: 0 }, size: { x: side, y: side } })
  return {
    regions: [
      { id: 'aperture', bounds: rect(aperture), cells: { x: 64, y: 64 }, encoding: { kind: 'amplitude' }, role: 'pattern' },
      { id: 'cells', bounds: rect(aperture * 0.75), cells: { x: 6, y: 6 }, encoding: { kind: 'blob-mode', sigma: (aperture * 0.75) / 6 / 6 }, role: 'memory' },
      ...(readout ? [{ id: 'detector', bounds: rect(aperture / 4), cells: { x: 8, y: 8 }, encoding: { kind: 'intensity' as const }, role: 'readout' }] : []),
    ],
    ports: [
      { id: 'x', direction: 'input', region: 'aperture', physicalPort: 'in', normalization: { kind: 'mean-intensity', value: 1 } },
      { id: 'y', direction: 'output', region: 'aperture', source: { kind: 'cavity' } },
      { id: 'write', direction: 'input', region: 'cells', physicalPort: 'in', normalization: { kind: 'none' } },
      { id: 'read', direction: 'output', region: 'cells', source: { kind: 'cavity' } },
      ...(readout ? [{ id: 'ccd', direction: 'output' as const, region: 'detector', source: { kind: 'readout' as const, readout } }] : []),
    ],
  }
}

const runtime = { seed: 1, historyLength: 400 }

// ── 1. PHASER chamber ────────────────────────────────────────────────────────────────────────────

/**
 * The PHASER recurrent photon chamber from the original design: 4 transmissive LCDs between an input coupler and a
 * readout coupler carrying a thin-film gain layer, read through M_out and a Fourier lens. The boundary is explicitly
 * periodic, matching that design's idealised lossless side walls.
 */
export function phaserChamber(): SimulationConfig {
  const pitch = 63.5e-6
  const d = 10e-3
  const px = pixels(64, pitch)
  const lcds: OpticalElementSpec[] = Array.from({ length: 4 }, (_, i) => ({
    kind: 'transmissive-lcd', id: `lcd${i + 1}`, label: `M_step ${i + 1}`, ...idealLcd(px, { kind: 'random', seed: 7 + i, depth: 0.08 }, 0.98),
  }))
  return {
    version: 1,
    name: 'PHASER chamber',
    physics: {
      field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'periodic' } },
      elements: [
        { kind: 'coupler', id: 'in', label: 'input coupler', retained: { front: 0.9, back: 0.9 }, inputPort: 'in' },
        ...lcds,
        { kind: 'coupler', id: 'out', label: 'readout coupler', retained: { front: 0.9, back: 0.9 }, outputTap: 'readout' },
        { kind: 'gain', id: 'gain', label: 'thin-film gain', smallSignalGain: 1.6, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
        { kind: 'nonlinear', id: 'kerr', label: 'Kerr film', amplitude: { kind: 'none' }, phase: { kind: 'none' } },
      ],
      topology: {
        kind: 'linear-reciprocal', length: 5 * d, medium: AIR,
        start: { elementIds: ['in'] }, end: { elementIds: ['out', 'gain', 'kerr'] },
        items: lcds.map((e, i) => ({ elementId: e.id, position: (i + 1) * d })),
      },
      readouts: [{
        id: 'ccd', tap: 'readout',
        stages: [{ kind: 'element', side: 'front', element: { kind: 'transmissive-lcd', id: 'mout', label: 'M_out', ...idealLcd(px, { kind: 'random', seed: 99, depth: 0.08 }) } }],
        detector: { kind: 'fourier-plane', focalLength: 0.05 },
      }],
    },
    computation: standardComputation(64 * pitch, 'ccd'),
    algorithm: { module: 'static-pattern', params: { pattern: 'smiley', mode: 'pulse' } },
    runtime,
  }
}

// ── 2. reflective SLM ring ───────────────────────────────────────────────────────────────────────

export function reflectiveSlmRing(): SimulationConfig {
  const pitch = 20e-6
  const f = 40e-3
  const lens = (id: string): OpticalElementSpec => ({ kind: 'lens', id, focalLength: f, apertureDiameter: 1.2e-3, transmission: { front: 0.995, back: 0.995 } })
  return {
    version: 1,
    name: 'Reflective SLM ring',
    physics: {
      field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.08 } },
      elements: [
        { kind: 'coupler', id: 'in', label: 'input coupler', retained: { front: 0.98, back: 0.98 }, inputPort: 'in' },
        {
          kind: 'lcos-slm', id: 'slm', label: 'LCOS SLM', pixels: pixels(64, pitch, 0.93), reflectivity: 0.75, deadZoneReflectivity: 0.2,
          phaseRange: TAU, phaseLevels: 256, phaseResponse: { kind: 'gamma', gamma: 1.05 }, switchingTime: 0.005, designWavelength: 633e-9,
          program: { kind: 'random', seed: 3, depth: 0.1 },
        },
        { kind: 'mirror', id: 'fold', label: 'fold mirror', reflectivity: { front: 0.995, back: 0.995 }, parity: 'none' },
        { kind: 'coupler', id: 'out', label: 'output coupler', retained: { front: 0.95, back: 0.95 }, outputTap: 'readout' },
        lens('lensR'),
        lens('lensL'),
        { kind: 'gain', id: 'gain', label: 'gain', smallSignalGain: 1.5, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
      ],
      topology: rectangularRing({
        width: 0.02, height: 0.08, medium: AIR,
        corners: ['slm', 'fold', 'out', 'in'],
        items: { right: [{ elementId: 'lensR', position: 0.04 }], left: [{ elementId: 'lensL', position: 0.04 }, { elementId: 'gain', position: 0.06 }] },
      }),
      readouts: [{ id: 'cam', tap: 'readout', stages: [], detector: { kind: 'near-field' } }],
    },
    computation: standardComputation(64 * pitch, 'cam'),
    algorithm: { module: 'static-pattern', params: { pattern: 'text', text: 'SLM' } },
    runtime,
  }
}

// ── 3. transmissive LCD linear cavity ────────────────────────────────────────────────────────────

const realisticLcd = (px: PixelArray, seed: number): LcdParams => ({
  pixels: px,
  modulation: { kind: 'phase', phaseRange: 1.8 * Math.PI, levels: 256, response: { kind: 'gamma', gamma: 1.1 } },
  clearTransmission: 0.92,
  surfaces: { front: { transmission: 0.98, reflection: 0.02 }, back: { transmission: 0.96, reflection: 0.04 } },
  polarizerTransmission: 0.95,
  deadZoneTransmission: 0,
  switchingTime: 0.008,
  designWavelength: 650e-9,
  program: { kind: 'random', seed, depth: 0.1 },
})

export function transmissiveLcdLinear(): SimulationConfig {
  const pitch = 63.5e-6
  const d = 8e-3
  const px = pixels(64, pitch, 0.85)
  const lcds: OpticalElementSpec[] = Array.from({ length: 6 }, (_, i) => ({ kind: 'transmissive-lcd', id: `lcd${i + 1}`, ...realisticLcd(px, 20 + i) }))
  return {
    version: 1,
    name: 'Transmissive LCD linear cavity',
    physics: {
      field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.06 } },
      elements: [
        { kind: 'coupler', id: 'in', label: 'input coupler', retained: { front: 0.92, back: 0.92 }, inputPort: 'in', outputTap: 'readout' },
        ...lcds,
        { kind: 'gain', id: 'gain', smallSignalGain: 2.2, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
        { kind: 'mirror', id: 'end', label: 'silver mirror', reflectivity: { front: 0.97, back: 0.97 }, parity: 'none' },
      ],
      topology: {
        kind: 'linear-reciprocal', length: 7 * d, medium: AIR, start: { elementIds: ['in'] }, end: { elementIds: ['gain', 'end'] },
        items: lcds.map((e, i) => ({ elementId: e.id, position: (i + 1) * d })),
      },
      readouts: [{ id: 'cam', tap: 'readout', stages: [], detector: { kind: 'near-field' } }],
    },
    computation: standardComputation(64 * pitch, 'cam'),
    algorithm: { module: 'cellular-memory', params: { generationCycles: 20, rule: 'hold' } },
    runtime,
  }
}

// ── 4. LCD + microlens stack with static mixers ─────────────────────────────────────────────────

export function lcdMicrolensStack(): SimulationConfig {
  const pitch = 63.5e-6
  const px = pixels(64, pitch, 0.85)
  const stack = (id: string, seed: number): LcdMicrolensSpec => ({
    kind: 'lcd-microlens', id,
    lcd: realisticLcd(px, seed),
    microlens: {
      pitch: { x: 4 * pitch, y: 4 * pitch }, focalLength: 20e-3, apertureDiameter: 4 * pitch, fillFactor: 0.95,
      transmission: { front: 0.96, back: 0.96 }, offset: { x: 0, y: 0 }, rotationRad: 0, focalLengthSigma: 0.02, seed,
    },
    spacing: 1e-3,
    spacingMedium: { kind: 'custom', label: 'glass', refractiveIndex: 1.52, groupIndex: 1.53, attenuationPerM: 0.5 },
  })
  const doe = (id: string, seed: number): OpticalElementSpec => ({
    kind: 'phase-plate', id, label: 'static mixer', pixels: pixels(64, pitch), transmission: { front: 0.97, back: 0.97 }, designWavelength: 650e-9,
    program: { kind: 'random', seed, depth: 0.5 },
  })
  const items = [stack('stack1', 31), doe('mix1', 41), stack('stack2', 32), doe('mix2', 42), stack('stack3', 33)]
  const d = 6e-3
  return {
    version: 1,
    name: 'LCD + microlens stack with static mixers',
    physics: {
      field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.06 } },
      elements: [
        { kind: 'coupler', id: 'in', retained: { front: 0.95, back: 0.95 }, inputPort: 'in', outputTap: 'readout' },
        ...items,
        { kind: 'gain', id: 'gain', smallSignalGain: 3, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
        { kind: 'mirror', id: 'end', reflectivity: { front: 0.99, back: 0.99 }, parity: 'none' },
      ],
      topology: {
        kind: 'linear-reciprocal', length: (items.length + 1) * d, medium: { kind: 'air', pressurePa: 10, temperatureK: 293.15, attenuationPerM: 0 },
        start: { elementIds: ['in'] }, end: { elementIds: ['gain', 'end'] },
        items: items.map((e, i) => ({ elementId: e.id, position: (i + 1) * d })),
      },
      readouts: [{ id: 'cam', tap: 'readout', stages: [], detector: { kind: 'near-field' } }],
    },
    computation: standardComputation(64 * pitch, 'cam'),
    algorithm: { module: 'static-pattern', params: { pattern: 'bits', seed: 4 } },
    runtime,
  }
}

// ── 5. low-loss idealised research cavity ────────────────────────────────────────────────────────

export function idealResearchCavity(): SimulationConfig {
  const pitch = 63.5e-6
  const d = 5e-3
  const px = pixels(64, pitch)
  const planes: OpticalElementSpec[] = Array.from({ length: 4 }, (_, i) => ({ kind: 'transmissive-lcd', id: `p${i + 1}`, ...idealLcd(px, { kind: 'zero' }) }))
  return {
    version: 1,
    name: 'Low-loss idealised research cavity',
    physics: {
      field: { grid: { nx: 128, ny: 128, dx: pitch / 2, dy: pitch / 2 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.05 } },
      elements: [
        { kind: 'coupler', id: 'in', retained: { front: 0.999, back: 0.999 }, inputPort: 'in', inputCoupling: 1, outputTap: 'readout' },
        ...planes,
        { kind: 'mirror', id: 'end', reflectivity: { front: 1, back: 1 }, parity: 'none' },
      ],
      topology: {
        kind: 'linear-reciprocal', length: 5 * d, medium: { kind: 'vacuum' }, start: { elementIds: ['in'] }, end: { elementIds: ['end'] },
        items: planes.map((e, i) => ({ elementId: e.id, position: (i + 1) * d })),
      },
      readouts: [{ id: 'cam', tap: 'readout', stages: [], detector: { kind: 'near-field' } }],
    },
    computation: standardComputation(64 * pitch, 'cam'),
    algorithm: { module: 'cellular-memory', params: { generationCycles: 10, rule: 'hold' } },
    runtime,
  }
}

export const PRESETS: { id: string; name: string; build: () => SimulationConfig }[] = [
  { id: 'phaser-chamber', name: 'PHASER chamber', build: phaserChamber },
  { id: 'slm-ring', name: 'Reflective SLM ring', build: reflectiveSlmRing },
  { id: 'lcd-linear', name: 'Transmissive LCD linear cavity', build: transmissiveLcdLinear },
  { id: 'lcd-mla-stack', name: 'LCD + microlens stack', build: lcdMicrolensStack },
  { id: 'ideal-research', name: 'Low-loss idealised cavity', build: idealResearchCavity },
]
