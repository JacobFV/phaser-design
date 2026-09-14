import type { ElementKind, OpticalElementSpec } from '../../core/physics/elements/types'
import { FractionInput } from '../components/inputs'
import { mediumField, phaseResponseField, pixelsGroup, programField } from './commonSchemas'
import { U, prefixed, type FieldDescriptor } from './schema'

const TAU = 2 * Math.PI
const px = () => ({ resolution: { x: 64, y: 64 }, pitch: { x: 63.5e-6, y: 63.5e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } })
const lcdParams = () => ({
  pixels: px(),
  modulation: { kind: 'phase' as const, phaseRange: TAU, levels: 0, response: { kind: 'linear' as const } },
  clearTransmission: 0.95,
  surfaces: { front: { transmission: 0.98, reflection: 0.02 }, back: { transmission: 0.98, reflection: 0.02 } },
  polarizerTransmission: 1,
  deadZoneTransmission: 0,
  switchingTime: 0.01,
  designWavelength: 650e-9,
  program: { kind: 'zero' as const },
})
const mlaParams = () => ({
  pitch: { x: 254e-6, y: 254e-6 }, focalLength: 20e-3, apertureDiameter: 254e-6, fillFactor: 0.95,
  transmission: { front: 0.96, back: 0.96 }, offset: { x: 0, y: 0 }, rotationRad: 0, focalLengthSigma: 0, seed: 1,
})

const lcdFields: FieldDescriptor[] = [
  pixelsGroup(['pixels']),
  {
    kind: 'union', path: ['modulation'], label: 'modulation', discriminant: 'kind',
    variants: {
      phase: {
        label: 'phase-mostly', template: () => ({ kind: 'phase', phaseRange: TAU, levels: 256, response: { kind: 'linear' } }),
        fields: [
          { kind: 'number', path: ['phaseRange'], label: 'phase stroke $\\Delta\\varphi$', unit: U.pi, min: 0 },
          { kind: 'integer', path: ['levels'], label: 'levels (0 = analogue)', min: 0 },
          phaseResponseField(['response']),
        ],
      },
      amplitude: {
        label: 'amplitude', template: () => ({ kind: 'amplitude', darkTransmission: 0.001, levels: 256 }),
        fields: [
          { kind: 'fraction', path: ['darkTransmission'], label: 'dark-state transmission' },
          { kind: 'integer', path: ['levels'], label: 'levels (0 = analogue)', min: 0 },
        ],
      },
    },
  },
  { kind: 'fraction', path: ['clearTransmission'], label: 'clear-state transmission' },
  {
    kind: 'group', label: 'surfaces (per incidence face)', fields: [
      { kind: 'fraction', path: ['surfaces', 'front', 'transmission'], label: 'front transmission' },
      { kind: 'fraction', path: ['surfaces', 'front', 'reflection'], label: 'front reflection (lost)' },
      { kind: 'fraction', path: ['surfaces', 'back', 'transmission'], label: 'back transmission' },
      { kind: 'fraction', path: ['surfaces', 'back', 'reflection'], label: 'back reflection (lost)' },
    ],
  },
  { kind: 'fraction', path: ['polarizerTransmission'], label: 'polarisation loss (transmission)' },
  { kind: 'fraction', path: ['deadZoneTransmission'], label: 'inter-pixel transmission' },
  { kind: 'number', path: ['switchingTime'], label: 'switching time', unit: U.ms, min: 0 },
  { kind: 'number', path: ['designWavelength'], label: 'design wavelength', unit: U.nm, min: 1e-9 },
  programField(['program']),
]

const mlaFields: FieldDescriptor[] = [
  { kind: 'vec2', path: ['pitch'], label: 'lenslet pitch', unit: U.um },
  { kind: 'number', path: ['focalLength'], label: 'focal length', unit: U.mm },
  { kind: 'number', path: ['apertureDiameter'], label: 'clear aperture', unit: U.um, min: 0 },
  { kind: 'fraction', path: ['fillFactor'], label: 'fill factor' },
  { kind: 'directional', path: ['transmission'], label: 'transmission' },
  { kind: 'vec2', path: ['offset'], label: 'offset from LCD pixels', unit: U.um },
  { kind: 'number', path: ['rotationRad'], label: 'rotation', unit: U.rad },
  { kind: 'number', path: ['focalLengthSigma'], label: 'focal-length error ($1\\sigma$, fraction)', min: 0 },
  { kind: 'integer', path: ['seed'], label: 'fabrication seed' },
]

const intensityResponse = (path: string[], label: string, phase: boolean): FieldDescriptor => ({
  kind: 'union', path, label, discriminant: 'kind',
  variants: phase
    ? {
        none: { label: 'none', template: () => ({ kind: 'none' }), fields: [] },
        kerr: { label: 'Kerr φ = c·I', template: () => ({ kind: 'kerr', coefficient: 1 }), fields: [{ kind: 'number', path: ['coefficient'], label: '$c$ (rad per unit intensity)' }] },
        'saturable-kerr': {
          label: 'saturable Kerr', template: () => ({ kind: 'saturable-kerr', maxPhase: 1, saturationIntensity: 1 }),
          fields: [{ kind: 'number', path: ['maxPhase'], label: '$\\varphi_{\\max}$', unit: U.rad }, { kind: 'number', path: ['saturationIntensity'], label: '$I_\\mathrm{sat}$', min: 0 }],
        },
      }
    : {
        none: { label: 'none', template: () => ({ kind: 'none' }), fields: [] },
        saturable: {
          label: 'saturable 1 + s/(1 + I/I_sat)', template: () => ({ kind: 'saturable', strength: -0.3, saturationIntensity: 1 }),
          fields: [{ kind: 'number', path: ['strength'], label: '$s$ ($< 0$ absorbs)' }, { kind: 'number', path: ['saturationIntensity'], label: '$I_\\mathrm{sat}$', min: 0 }],
        },
      },
})

export interface ElementKindInfo {
  kind: ElementKind
  label: string
  description: string
  template: (id: string) => OpticalElementSpec
  fields: FieldDescriptor[]
}

export const ELEMENT_KINDS: ElementKindInfo[] = [
  {
    kind: 'mirror', label: 'Mirror', description: 'Reflector with per-face reflectivity and image parity.',
    template: (id) => ({ kind: 'mirror', id, reflectivity: { front: 0.99, back: 0.99 }, parity: 'none' }),
    fields: [
      { kind: 'directional', path: ['reflectivity'], label: 'reflectivity' },
      { kind: 'select', path: ['parity'], label: 'image parity', options: [{ value: 'none', label: 'none' }, { value: 'flip-x', label: 'flip x' }, { value: 'flip-y', label: 'flip y' }] },
    ],
  },
  {
    kind: 'coupler', label: 'Partial coupler', description: 'Keeps the retained fraction in the route; can tap the rest out and inject input on its front face.',
    template: (id) => ({ kind: 'coupler', id, retained: { front: 0.9, back: 0.9 } }),
    fields: [
      { kind: 'directional', path: ['retained'], label: 'retained (in-cavity) power' },
      { kind: 'text', path: ['outputTap'], label: 'output tap id' },
      { kind: 'text', path: ['inputPort'], label: 'input port id' },
      {
        kind: 'custom', label: 'input coupling',
        render: (v, set) => {
          const c = v as { inputCoupling?: number; retained: { front: number } }
          return (
            <span className="row-control">
              <label className="link-toggle">
                <input type="checkbox" checked={c.inputCoupling !== undefined} onChange={(e) => set(['inputCoupling'], e.target.checked ? 1 - c.retained.front : undefined)} />
                override (default 1 − retained)
              </label>
              {c.inputCoupling !== undefined && <FractionInput value={c.inputCoupling} onCommit={(x) => set(['inputCoupling'], x)} />}
            </span>
          )
        },
      },
    ],
  },
  {
    kind: 'lens', label: 'Thin lens', description: 'Quadratic phase with a circular clear aperture.',
    template: (id) => ({ kind: 'lens', id, focalLength: 0.05, apertureDiameter: 2e-3, transmission: { front: 0.99, back: 0.99 } }),
    fields: [
      { kind: 'number', path: ['focalLength'], label: 'focal length $f$', unit: U.mm },
      { kind: 'number', path: ['apertureDiameter'], label: 'aperture $\\varnothing$', unit: U.mm, min: 0 },
      { kind: 'directional', path: ['transmission'], label: 'transmission' },
    ],
  },
  { kind: 'microlens-array', label: 'Microlens array', description: 'Lattice of lenslets that take part in field propagation.', template: (id) => ({ kind: 'microlens-array', id, ...mlaParams() }), fields: mlaFields },
  {
    kind: 'aperture', label: 'Aperture', description: 'Rectangular or circular stop with a soft edge.',
    template: (id) => ({ kind: 'aperture', id, shape: 'rect', size: { x: 3e-3, y: 3e-3 }, softEdge: 50e-6 }),
    fields: [
      { kind: 'select', path: ['shape'], label: 'shape', options: [{ value: 'rect', label: 'rectangle' }, { value: 'circle', label: 'circle (x = diameter)' }] },
      { kind: 'vec2', path: ['size'], label: 'size', unit: U.mm },
      { kind: 'number', path: ['softEdge'], label: 'soft edge', unit: U.um, min: 0 },
    ],
  },
  {
    kind: 'lcos-slm', label: 'Reflective SLM (LCOS)', description: 'Reflective phase modulator; the backplane is opaque.',
    template: (id) => ({
      kind: 'lcos-slm', id, pixels: { ...px(), pitch: { x: 20e-6, y: 20e-6 }, fillFactor: 0.93 }, reflectivity: 0.75, deadZoneReflectivity: 0.2,
      phaseRange: TAU, phaseLevels: 256, phaseResponse: { kind: 'linear' }, switchingTime: 0.005, designWavelength: 633e-9, program: { kind: 'zero' },
    }),
    fields: [
      pixelsGroup(['pixels']),
      { kind: 'fraction', path: ['reflectivity'], label: 'pixel reflectivity' },
      { kind: 'fraction', path: ['deadZoneReflectivity'], label: 'inter-pixel reflectivity' },
      { kind: 'number', path: ['phaseRange'], label: 'phase stroke $\\Delta\\varphi$', unit: U.pi, min: 0 },
      { kind: 'integer', path: ['phaseLevels'], label: 'levels (0 = analogue)', min: 0 },
      phaseResponseField(['phaseResponse']),
      { kind: 'number', path: ['switchingTime'], label: 'switching time', unit: U.ms, min: 0 },
      { kind: 'number', path: ['designWavelength'], label: 'design wavelength', unit: U.nm },
      programField(['program']),
    ],
  },
  { kind: 'transmissive-lcd', label: 'Transmissive LCD', description: 'Pixelated LC cell with explicit surface, polarisation and dead-zone losses.', template: (id) => ({ kind: 'transmissive-lcd', id, ...lcdParams() }), fields: lcdFields },
  {
    kind: 'lcd-microlens', label: 'LCD + microlens array', description: 'Bonded LCD and MLA. Front: LCD → gap → MLA. Back: MLA → gap → LCD.',
    template: (id) => ({ kind: 'lcd-microlens', id, lcd: lcdParams(), microlens: mlaParams(), spacing: 1e-3, spacingMedium: { kind: 'custom', label: 'glass', refractiveIndex: 1.52, groupIndex: 1.53, attenuationPerM: 0 } }),
    fields: [
      { kind: 'group', label: 'LCD', fields: prefixed(['lcd'], lcdFields) },
      { kind: 'group', label: 'microlens array', fields: prefixed(['microlens'], mlaFields) },
      { kind: 'number', path: ['spacing'], label: 'LCD–MLA spacing', unit: U.mm, min: 0 },
      mediumField(['spacingMedium'], 'spacing medium'),
    ],
  },
  {
    kind: 'phase-plate', label: 'Static phase plate / DOE', description: 'Fixed pixelated phase mixer.',
    template: (id) => ({ kind: 'phase-plate', id, pixels: px(), transmission: { front: 0.97, back: 0.97 }, designWavelength: 650e-9, program: { kind: 'random', seed: 1, depth: 0.5 } }),
    fields: [pixelsGroup(['pixels']), { kind: 'directional', path: ['transmission'], label: 'transmission' }, { kind: 'number', path: ['designWavelength'], label: 'design wavelength', unit: U.nm }, programField(['program'], 'phase profile')],
  },
  {
    kind: 'gain', label: 'Gain medium', description: 'Signal gain with optional saturation and additive noise.',
    template: (id) => ({ kind: 'gain', id, smallSignalGain: 1.5, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } }),
    fields: [
      { kind: 'number', path: ['smallSignalGain'], label: 'small-signal power gain $G_0$', min: 0 },
      {
        kind: 'union', path: ['saturation'], label: 'saturation', discriminant: 'kind',
        variants: {
          none: { label: 'none', template: () => ({ kind: 'none' }), fields: [] },
          global: { label: 'global (mean intensity)', template: () => ({ kind: 'global', saturationIntensity: 0.5 }), fields: [{ kind: 'number', path: ['saturationIntensity'], label: '$I_\\mathrm{sat}$', min: 0 }] },
          local: { label: 'local (per sample)', template: () => ({ kind: 'local', saturationIntensity: 0.5 }), fields: [{ kind: 'number', path: ['saturationIntensity'], label: '$I_\\mathrm{sat}$', min: 0 }] },
        },
      },
      {
        kind: 'union', path: ['noise'], label: 'noise', discriminant: 'kind',
        variants: {
          none: { label: 'none', template: () => ({ kind: 'none' }), fields: [] },
          'additive-gaussian': {
            label: 'additive Gaussian', template: () => ({ kind: 'additive-gaussian', meanIntensity: 1e-4, seed: 1 }),
            fields: [{ kind: 'number', path: ['meanIntensity'], label: 'added mean intensity / pass', min: 0 }, { kind: 'integer', path: ['seed'], label: 'seed' }],
          },
        },
      },
    ],
  },
  {
    kind: 'nonlinear', label: 'Nonlinear medium', description: "Local response $E' = g(|E|^2)\\,e^{i\\varphi(|E|^2)}\\,E$.",
    template: (id) => ({ kind: 'nonlinear', id, amplitude: { kind: 'none' }, phase: { kind: 'kerr', coefficient: 1 } }),
    fields: [intensityResponse(['amplitude'], 'amplitude response', false), intensityResponse(['phase'], 'phase response', true)],
  },
]

export const kindInfo = (kind: ElementKind) => ELEMENT_KINDS.find((k) => k.kind === kind)!
