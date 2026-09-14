import type { ComputationalRegionSpec, PortSpec } from '../../core/computation/regions'
import { U, type FieldDescriptor } from './schema'

export const regionFields: FieldDescriptor[] = [
  { kind: 'text', path: ['role'], label: 'role (free label)' },
  {
    kind: 'union', path: ['bounds'], label: 'bounds', discriminant: 'kind',
    variants: {
      rect: {
        label: 'rectangle', template: () => ({ kind: 'rect', center: { x: 0, y: 0 }, size: { x: 2e-3, y: 2e-3 } }),
        fields: [{ kind: 'vec2', path: ['center'], label: 'centre', unit: U.um }, { kind: 'vec2', path: ['size'], label: 'size', unit: U.um }],
      },
      circle: {
        label: 'circle', template: () => ({ kind: 'circle', center: { x: 0, y: 0 }, radius: 1e-3 }),
        fields: [{ kind: 'vec2', path: ['center'], label: 'centre', unit: U.um }, { kind: 'number', path: ['radius'], label: 'radius', unit: U.um, min: 0 }],
      },
    },
  },
  { kind: 'integer', path: ['cells', 'x'], label: 'cells across', min: 1 },
  { kind: 'integer', path: ['cells', 'y'], label: 'cells down', min: 1 },
  {
    kind: 'union', path: ['encoding'], label: 'encoding', discriminant: 'kind',
    variants: {
      intensity: { label: 'intensity', template: () => ({ kind: 'intensity' }), fields: [] },
      amplitude: { label: 'amplitude', template: () => ({ kind: 'amplitude' }), fields: [] },
      phase: { label: 'phase', template: () => ({ kind: 'phase' }), fields: [] },
      complex: { label: 'complex amplitude', template: () => ({ kind: 'complex' }), fields: [] },
      'differential-intensity': {
        label: 'differential intensity', template: () => ({ kind: 'differential-intensity', axis: 'x' }),
        fields: [{ kind: 'select', path: ['axis'], label: 'split axis', options: [{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }] }],
      },
      'blob-mode': {
        label: 'Gaussian blob mode', template: () => ({ kind: 'blob-mode', sigma: 50e-6 }),
        fields: [{ kind: 'number', path: ['sigma'], label: 'mode $\\sigma$ (intensity rms)', unit: U.um, min: 0 }],
      },
    },
  },
]

export function portFields(regionIds: string[]): FieldDescriptor[] {
  const regions = regionIds.map((r) => ({ value: r, label: r }))
  return [{
    kind: 'union', path: [], label: 'direction', discriminant: 'direction',
    variants: {
      input: {
        label: 'input', template: () => ({ direction: 'input', region: regionIds[0] ?? '', physicalPort: 'in', normalization: { kind: 'none' } }),
        fields: [
          { kind: 'select', path: ['region'], label: 'region', options: regions },
          { kind: 'text', path: ['physicalPort'], label: 'physical input port' },
          {
            kind: 'union', path: ['normalization'], label: 'normalisation', discriminant: 'kind',
            variants: {
              none: { label: 'none', template: () => ({ kind: 'none' }), fields: [] },
              'mean-intensity': { label: 'mean intensity', template: () => ({ kind: 'mean-intensity', value: 1 }), fields: [{ kind: 'number', path: ['value'], label: 'target', min: 0 }] },
            },
          },
        ],
      },
      output: {
        label: 'output', template: () => ({ direction: 'output', region: regionIds[0] ?? '', source: { kind: 'cavity' } }),
        fields: [
          { kind: 'select', path: ['region'], label: 'region', options: regions },
          {
            kind: 'union', path: ['source'], label: 'source', discriminant: 'kind',
            variants: {
              cavity: { label: 'circulating field', template: () => ({ kind: 'cavity' }), fields: [] },
              tap: { label: 'tap', template: () => ({ kind: 'tap', tap: 'readout' }), fields: [{ kind: 'text', path: ['tap'], label: 'tap id' }] },
              readout: { label: 'detector readout', template: () => ({ kind: 'readout', readout: 'ccd' }), fields: [{ kind: 'text', path: ['readout'], label: 'readout id' }] },
            },
          },
        ],
      },
    },
  }]
}

export const newRegion = (id: string): ComputationalRegionSpec => ({
  id, bounds: { kind: 'rect', center: { x: 0, y: 0 }, size: { x: 1e-3, y: 1e-3 } }, cells: { x: 4, y: 4 }, encoding: { kind: 'intensity' },
})

export const newPort = (id: string, region: string): PortSpec => ({ id, direction: 'output', region, source: { kind: 'cavity' } })
