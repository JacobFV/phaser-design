/**
 * The physical configurations used in this research sprint. Scratch code: plain functions returning PhysicsConfig,
 * derived from the shipped presets (src/core/runtime/presets.ts) with the changes documented inline.
 *
 *  A  slmRing      reflective LCOS ring (preset "Reflective SLM ring" elements/losses/leg lengths)
 *  B  linear4f     linear reciprocal LCD cavity (preset "Transmissive LCD linear cavity" LCD/coupler/mirror losses)
 *  C  lcdMla       cheap transmissive LCD bonded to a microlens array (preset "LCD + microlens stack" parts)
 */
import type { GainSpec, MaskProgram, NonlinearSpec, OpticalElementSpec, PixelArray, TransmissiveLcdSpec } from '../../src/core/physics/elements/types'
import type { MediumSpec } from '../../src/core/physics/media/media'
import type { PhysicsConfig } from '../../src/core/physics/system'
import type { CustomRouteItem } from '../../src/core/physics/topology/topology'

export const AIR: MediumSpec = { kind: 'air', pressurePa: 101_325, temperatureK: 288.15, attenuationPerM: -Math.log(0.998) }
const LOW_AIR: MediumSpec = { kind: 'air', pressurePa: 10, temperatureK: 293.15, attenuationPerM: 0 }

export interface Active {
  /** small-signal POWER gain per round trip; saturation model */
  gain?: { G0: number; sat: GainSpec['saturation']; noise?: GainSpec['noise'] }
  nl?: { amplitude: NonlinearSpec['amplitude']; phase: NonlinearSpec['phase'] }
}

export interface ArchOptions extends Active {
  n?: number // grid samples per axis
  spp?: number // field samples per modulator pixel (2 in every preset)
  wavelength?: number
  mask?: MaskProgram
  boundary?: number // absorbing width fraction
}

const pixels = (res: number, pitch: number, fillFactor: number): PixelArray => ({ resolution: { x: res, y: res }, pitch: { x: pitch, y: pitch }, fillFactor, offset: { x: 0, y: 0 } })

function activeElements(o: Active): { els: OpticalElementSpec[]; ids: string[] } {
  const els: OpticalElementSpec[] = []
  if (o.nl) els.push({ kind: 'nonlinear', id: 'nl', amplitude: o.nl.amplitude, phase: o.nl.phase })
  if (o.gain) els.push({ kind: 'gain', id: 'gain', smallSignalGain: o.gain.G0, saturation: o.gain.sat, noise: o.gain.noise ?? { kind: 'none' } })
  return { els, ids: els.map((e) => e.id) }
}

// ── A. reflective SLM ring ────────────────────────────────────────────────────────────────────────
export interface RingOptions extends ArchOptions {
  focal?: number // relay lens focal length. preset: 40 mm (stable, non-degenerate). 50 mm: 2f spacing → round trip −I
  roof?: boolean // add flip-x (fold) + flip-y (extra roof mirror) so the self-imaging round trip is +I instead of −I
  focalErrorR?: number // fractional focal-length error of lensR only (misalignment / tolerance)
  maxStep?: number // split every free-space segment into pieces ≤ maxStep so the absorbing taper catches high-angle light (avoids FFT wrap-around)
  defocus?: number // extra free-space propagation per round trip in the image plane (m): round trip ABCD = [[1, δ], [0, 1]]
  ampMask?: { dark: number; program?: MaskProgram } // static absorbing amplitude LCD directly after the SLM (cells clear, gaps dark)
  inputFirst?: boolean // put the input coupler immediately before the SLM (injection in the SLM/image plane; scalar, so the circulating dynamics are unchanged)
  compact?: boolean // merge segments separated only by uniform scalar elements (validated equal to the full route)
}

/**
 * Preset leg lengths: top 20 mm → SLM corner → right 40 mm → lensR → 40 mm → fold → bottom 20 mm → out → left 40 mm → lensL → 20 mm → (gain) → 20 mm → in.
 * Lens-to-lens spacing is 100 mm in both directions. Local nonlinearity/gain is placed in the SLM plane (the preset's
 * gain is global, so its position did not matter there).
 */
export function slmRing(o: RingOptions = {}): PhysicsConfig {
  const pitch = 20e-6
  const spp = o.spp ?? 2
  const n = o.n ?? 64
  const f = o.focal ?? 50e-3
  const lens = (id: string, err = 0): OpticalElementSpec => ({ kind: 'lens', id, focalLength: f * (1 + err), apertureDiameter: 1.2e-3, transmission: { front: 0.995, back: 0.995 } })
  const act = activeElements(o)
  const elements: OpticalElementSpec[] = [
    { kind: 'coupler', id: 'in', retained: { front: 0.98, back: 0.98 }, inputPort: 'in' },
    {
      kind: 'lcos-slm', id: 'slm', pixels: pixels(64 * spp >= n ? 64 : Math.ceil(n / spp), pitch, 0.93), reflectivity: 0.75, deadZoneReflectivity: 0.2,
      phaseRange: 2 * Math.PI, phaseLevels: 256, phaseResponse: { kind: 'gamma', gamma: 1.05 }, switchingTime: 0.005, designWavelength: 633e-9,
      program: o.mask ?? { kind: 'zero' },
    },
    { kind: 'mirror', id: 'fold', reflectivity: { front: 0.995, back: 0.995 }, parity: o.roof ? 'flip-x' : 'none' },
    { kind: 'mirror', id: 'roof', reflectivity: { front: 0.995, back: 0.995 }, parity: o.roof ? 'flip-y' : 'none' },
    { kind: 'coupler', id: 'out', retained: { front: 0.95, back: 0.95 }, outputTap: 'readout' },
    lens('lensR', o.focalErrorR ?? 0), lens('lensL'),
    ...act.els,
    ...(o.ampMask ? [{
      kind: 'transmissive-lcd', id: 'amp', label: 'static absorbing amplitude mask',
      pixels: pixels(64 * spp >= n ? 64 : Math.ceil(n / spp), pitch, 1),
      modulation: { kind: 'amplitude', darkTransmission: o.ampMask.dark, levels: 256 },
      clearTransmission: 1, surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
      polarizerTransmission: 1, deadZoneTransmission: 0, switchingTime: 0.01, designWavelength: 650e-9,
      program: o.ampMask.program ?? { kind: 'zero' },
    } as OpticalElementSpec] : []),
  ]
  const P1 = (length: number, medium = AIR): CustomRouteItem => ({ kind: 'propagate', length, medium })
  const E = (elementId: string): CustomRouteItem => ({ kind: 'element', elementId, side: 'front' })
  const P = P1
  const route0: CustomRouteItem[] = o.compact === false
    ? [E('slm'), ...act.ids.map(E), P(40e-3), E('lensR'), P(40e-3), E('fold'), E('roof'), P(20e-3), E('out'), P(40e-3), E('lensL'), P(20e-3), P(20e-3), E('in'), P(20e-3)]
    : o.inputFirst
      ? [E('in'), E('slm'), ...act.ids.map(E), P(40e-3), E('lensR'), E('fold'), E('roof'), E('out'), P(100e-3), E('lensL'), P(60e-3 + (o.defocus ?? 0))]
      : [E('slm'), ...act.ids.map(E), P(40e-3), E('lensR'), E('fold'), E('roof'), E('out'), P(100e-3), E('lensL'), E('in'), P(60e-3 + (o.defocus ?? 0))]
  if (o.ampMask) route0.splice(route0.findIndex((r) => r.kind === 'element' && r.elementId === 'slm') + 1, 0, E('amp'))
  const route = o.maxStep
    ? route0.flatMap((it) => (it.kind === 'propagate' ? Array.from({ length: Math.ceil(it.length / o.maxStep! - 1e-9) }, (_, _i, k = Math.ceil(it.length / o.maxStep! - 1e-9)) => ({ ...it, length: it.length / k })) : [it]))
    : route0
  return {
    field: { grid: { nx: n, ny: n, dx: pitch / spp, dy: pitch / spp }, wavelength: o.wavelength ?? 650e-9, boundary: { kind: 'absorbing', widthFraction: o.boundary ?? 0.08 } },
    elements,
    topology: { kind: 'custom', route },
    readouts: [],
  }
}

// ── B. linear reciprocal 4f LCD cavity ────────────────────────────────────────────────────────────
const realisticLcd = (px: PixelArray, program: MaskProgram): Omit<TransmissiveLcdSpec, 'kind' | 'id' | 'label'> => ({
  pixels: px,
  modulation: { kind: 'phase', phaseRange: 1.8 * Math.PI, levels: 256, response: { kind: 'gamma', gamma: 1.1 } },
  clearTransmission: 0.92,
  surfaces: { front: { transmission: 0.98, reflection: 0.02 }, back: { transmission: 0.96, reflection: 0.04 } },
  polarizerTransmission: 0.95,
  deadZoneTransmission: 0,
  switchingTime: 0.008,
  designWavelength: 650e-9,
  program,
})

export interface LinearOptions extends ArchOptions {
  focal?: number // two relay lenses at f and 3f; mirrors at 0 and 4f. forward pass −I, round trip +I
  lensless?: boolean // plane-parallel LCD cavity of the same length (the preset has no lenses)
}

/** in-coupler | LCD at the start mirror | f | L1 | 2f | L2 | f | end mirror. Every segment traversed twice. */
export function linear4f(o: LinearOptions = {}): PhysicsConfig {
  const pitch = 63.5e-6
  const spp = o.spp ?? 2
  const n = o.n ?? 64
  // f = 100 mm: with dx = 31.75 µm the thin-lens phase is only alias-free for r < λf/(2dx) ≈ 1.02 mm (f = 20 mm aliased)
  const f = o.focal ?? 100e-3
  const act = activeElements(o)
  const lens = (id: string): OpticalElementSpec => ({ kind: 'lens', id, focalLength: f, apertureDiameter: 2e-3, transmission: { front: 0.995, back: 0.995 } })
  const lensIds = o.lensless ? [] : ['L1', 'L2']
  return {
    field: { grid: { nx: n, ny: n, dx: pitch / spp, dy: pitch / spp }, wavelength: o.wavelength ?? 650e-9, boundary: { kind: 'absorbing', widthFraction: o.boundary ?? 0.08 } },
    elements: [
      { kind: 'coupler', id: 'in', retained: { front: 0.92, back: 0.92 }, inputPort: 'in', outputTap: 'readout' },
      { kind: 'transmissive-lcd', id: 'lcd', ...realisticLcd(pixels(Math.max(64, Math.ceil(n / spp)), pitch, 0.85), o.mask ?? { kind: 'zero' }) },
      ...(o.lensless ? [] : [lens('L1'), lens('L2')]),
      { kind: 'mirror', id: 'end', reflectivity: { front: 0.97, back: 0.97 }, parity: 'none' },
      ...act.els,
    ],
    topology: {
      kind: 'linear-reciprocal', length: 4 * f, medium: AIR,
      start: { elementIds: ['in', ...act.ids] }, end: { elementIds: ['end'] },
      items: [{ elementId: 'lcd', position: 0 }, ...lensIds.map((id, i) => ({ elementId: id, position: (1 + 2 * i) * f }))],
    },
    readouts: [],
  }
}

// ── C. cheap LCD + microlens array ────────────────────────────────────────────────────────────────
export interface MlaOptions extends ArchOptions {
  mlaPitchPx?: number // lenslet pitch in LCD pixels (preset 4)
  mlaFocal?: number // preset 20 mm
  d1?: number // start mirror → LCD/MLA composite (default = f: per-lenslet cat's-eye, −I about each lenslet centre)
  d2?: number
  focalSigma?: number // preset 0.02
}

export function lcdMla(o: MlaOptions = {}): PhysicsConfig {
  const pitch = 63.5e-6
  const spp = o.spp ?? 2
  const n = o.n ?? 64
  const fm = o.mlaFocal ?? 20e-3
  const g = o.mlaPitchPx ?? 4
  const act = activeElements(o)
  // cat's-eye per lenslet needs lens-to-lens reduced distance 2f both ways: the 1 mm glass gap counts as 1/1.52 mm
  const d1 = o.d1 ?? fm - 1e-3 / 1.52, d2 = o.d2 ?? fm
  return {
    field: { grid: { nx: n, ny: n, dx: pitch / spp, dy: pitch / spp }, wavelength: o.wavelength ?? 650e-9, boundary: { kind: 'absorbing', widthFraction: o.boundary ?? 0.08 } },
    elements: [
      { kind: 'coupler', id: 'in', retained: { front: 0.95, back: 0.95 }, inputPort: 'in', outputTap: 'readout' },
      {
        kind: 'lcd-microlens', id: 'stack',
        lcd: realisticLcd(pixels(Math.max(64, Math.ceil(n / spp)), pitch, 0.85), o.mask ?? { kind: 'zero' }),
        microlens: {
          pitch: { x: g * pitch, y: g * pitch }, focalLength: fm, apertureDiameter: g * pitch, fillFactor: 0.95,
          transmission: { front: 0.96, back: 0.96 }, offset: { x: 0, y: 0 }, rotationRad: 0, focalLengthSigma: o.focalSigma ?? 0.02, seed: 31,
        },
        spacing: 1e-3,
        spacingMedium: { kind: 'custom', label: 'glass', refractiveIndex: 1.52, groupIndex: 1.53, attenuationPerM: 0.5 },
      },
      { kind: 'mirror', id: 'end', reflectivity: { front: 0.99, back: 0.99 }, parity: 'none' },
      ...act.els,
    ],
    topology: {
      kind: 'linear-reciprocal', length: d1 + d2, medium: LOW_AIR,
      start: { elementIds: ['in', ...act.ids] }, end: { elementIds: ['end'] },
      items: [{ elementId: 'stack', position: d1 }],
    },
    readouts: [],
  }
}
