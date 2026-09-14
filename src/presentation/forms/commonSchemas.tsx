import { GAS_IDS } from '../../core/physics/media/media'
import { U, type FieldDescriptor, type Path } from './schema'

export const mediumField = (path: Path, label = 'medium'): FieldDescriptor => ({
  kind: 'union', path, label, discriminant: 'kind',
  variants: {
    vacuum: { label: 'vacuum', template: () => ({ kind: 'vacuum' }), fields: [] },
    air: {
      label: 'air',
      template: () => ({ kind: 'air', pressurePa: 101_325, temperatureK: 288.15, attenuationPerM: -Math.log(0.998) }),
      fields: [
        { kind: 'number', path: ['pressurePa'], label: 'pressure', unit: U.kPa, min: 0 },
        { kind: 'number', path: ['temperatureK'], label: 'temperature', unit: U.K, min: 1 },
        { kind: 'number', path: ['attenuationPerM'], label: 'power attenuation $\\alpha$', unit: U.perM, min: 0 },
      ],
    },
    gas: {
      label: 'gas',
      template: () => ({ kind: 'gas', gas: 'helium', pressurePa: 101_325, temperatureK: 293.15, attenuationPerM: 0 }),
      fields: [
        { kind: 'select', path: ['gas'], label: 'gas', options: GAS_IDS.map((g) => ({ value: g, label: g })) },
        { kind: 'number', path: ['pressurePa'], label: 'pressure', unit: U.kPa, min: 0 },
        { kind: 'number', path: ['temperatureK'], label: 'temperature', unit: U.K, min: 1 },
        { kind: 'number', path: ['attenuationPerM'], label: 'power attenuation $\\alpha$', unit: U.perM, min: 0 },
      ],
    },
    custom: {
      label: 'custom',
      template: () => ({ kind: 'custom', refractiveIndex: 1.5, groupIndex: 1.52, attenuationPerM: 0 }),
      fields: [
        { kind: 'number', path: ['refractiveIndex'], label: 'phase index $n$', min: 0 },
        { kind: 'number', path: ['groupIndex'], label: 'group index $n_g$', min: 0 },
        { kind: 'number', path: ['attenuationPerM'], label: 'power attenuation $\\alpha$', unit: U.perM, min: 0 },
      ],
    },
  },
})

export const programField = (path: Path, label = 'program'): FieldDescriptor => ({
  kind: 'union', path, label, discriminant: 'kind',
  variants: {
    zero: { label: 'zero (identity)', template: () => ({ kind: 'zero' }), fields: [] },
    random: {
      label: 'random phase', template: () => ({ kind: 'random', seed: 1, depth: 0.1 }),
      fields: [
        { kind: 'integer', path: ['seed'], label: 'seed' },
        { kind: 'number', path: ['depth'], label: 'depth ($\\times 2\\pi$)', min: 0, max: 1 },
      ],
    },
    grating: {
      label: 'blazed grating', template: () => ({ kind: 'grating', periodPx: 12, depth: 0.5, orientation: 'diagonal' }),
      fields: [
        { kind: 'integer', path: ['periodPx'], label: 'period (px)', min: 1 },
        { kind: 'number', path: ['depth'], label: 'depth ($\\times 2\\pi$)', min: 0, max: 1 },
        { kind: 'select', path: ['orientation'], label: 'orientation', options: ['x', 'y', 'diagonal', 'antidiagonal'].map((v) => ({ value: v, label: v })) },
      ],
    },
    lenslets: {
      label: 'lenslet array', template: () => ({ kind: 'lenslets', groupPx: 16, depth: 0.3 }),
      fields: [
        { kind: 'integer', path: ['groupPx'], label: 'lenslet size (px)', min: 2 },
        { kind: 'number', path: ['depth'], label: 'depth ($\\times 2\\pi$)', min: 0, max: 1 },
      ],
    },
    array: {
      label: 'external array', template: () => ({ kind: 'zero' }), // arrays are attached via "load phase array"
      fields: [{
        kind: 'custom', label: 'asset',
        render: (v) => {
          const ref = (v as { ref?: { id: string; hash: string; width: number; height: number } }).ref
          return ref ? `${ref.id} · ${ref.width}×${ref.height} · #${ref.hash}` : 'use "load phase array" on the element'
        },
      }],
    },
  },
})

export const phaseResponseField = (path: Path): FieldDescriptor => ({
  kind: 'union', path, label: 'phase response', discriminant: 'kind',
  variants: {
    linear: { label: 'linear', template: () => ({ kind: 'linear' }), fields: [] },
    gamma: { label: 'gamma', template: () => ({ kind: 'gamma', gamma: 1.1 }), fields: [{ kind: 'number', path: ['gamma'], label: '$\\gamma$', min: 0.05 }] },
    lut: {
      label: 'lookup table', template: () => ({ kind: 'lut', table: [0, 0.3, 0.55, 0.8, 1] }),
      fields: [{
        kind: 'custom', label: 'table (comma-separated, 0..1)',
        render: (v, set) => (
          <input
            className="text wide"
            defaultValue={((v as { table: number[] }).table ?? []).join(', ')}
            onBlur={(e) => set(['table'], e.target.value.split(',').map(Number).filter(Number.isFinite))}
          />
        ),
      }],
    },
  },
})

export const pixelsGroup = (path: Path): FieldDescriptor => ({
  kind: 'group', label: 'pixel array', fields: [
    { kind: 'integer', path: [...path, 'resolution', 'x'], label: 'columns', min: 1 },
    { kind: 'integer', path: [...path, 'resolution', 'y'], label: 'rows', min: 1 },
    { kind: 'vec2', path: [...path, 'pitch'], label: 'pitch', unit: U.um },
    { kind: 'fraction', path: [...path, 'fillFactor'], label: 'fill factor (area)' },
    { kind: 'vec2', path: [...path, 'offset'], label: 'panel offset', unit: U.um },
  ],
})
