import { describe, expect, it } from 'vitest'
import { AssetStore } from '../src/core/physics/assets'
import { NULL_CONTEXT, type ElementEnv } from '../src/core/physics/elements/element'
import { buildElement } from '../src/core/physics/elements/models'
import { buildPixelMap } from '../src/core/physics/elements/pixels'
import type { OpticalElementSpec } from '../src/core/physics/elements/types'
import { cloneField, createField, fieldPower, type Field, type GridSpec } from '../src/core/physics/field/grid'
import { KernelCache } from '../src/core/physics/propagation/angularSpectrum'
import { lcd } from './helpers'

const grid: GridSpec = { nx: 32, ny: 32, dx: 20e-6, dy: 20e-6 }
const env = (): ElementEnv => ({ grid, wavelength: 650e-9, kernels: new KernelCache(), assets: new AssetStore() })

const uniform = (): Field => {
  const f = createField(grid)
  f.re.fill(1)
  return f
}

describe('directional device behaviour', () => {
  it('an asymmetric LCD applies its front and back surface transmission independently', () => {
    const el = buildElement(lcd({ surfaces: { front: { transmission: 0.9, reflection: 0.1 }, back: { transmission: 0.5, reflection: 0.5 } } }), env())
    const a = uniform(), b = uniform()
    const p0 = fieldPower(a)
    el.apply(a, 'front', NULL_CONTEXT)
    el.apply(b, 'back', NULL_CONTEXT)
    expect(fieldPower(a) / p0).toBeCloseTo(0.9, 12)
    expect(fieldPower(b) / p0).toBeCloseTo(0.5, 12)
  })

  it('an LCOS backplane is opaque from the back', () => {
    const el = buildElement({
      kind: 'lcos-slm', id: 'slm', pixels: { resolution: { x: 16, y: 16 }, pitch: { x: 40e-6, y: 40e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } },
      reflectivity: 0.8, deadZoneReflectivity: 0, phaseRange: 2 * Math.PI, phaseLevels: 256, phaseResponse: { kind: 'linear' },
      switchingTime: 0.005, designWavelength: 650e-9, program: { kind: 'random', seed: 1, depth: 1 },
    }, env())
    const a = uniform(), b = uniform()
    const p0 = fieldPower(a)
    el.apply(a, 'front', NULL_CONTEXT)
    el.apply(b, 'back', NULL_CONTEXT)
    expect(fieldPower(a) / p0).toBeCloseTo(0.8, 12)
    expect(fieldPower(b)).toBe(0)
  })

  it('LCD + microlens is not symmetric: front and back traversals give different fields', () => {
    const spec: OpticalElementSpec = {
      kind: 'lcd-microlens', id: 'stack',
      lcd: (({ kind, id, label, ...rest }) => rest)(lcd({ program: { kind: 'random', seed: 3, depth: 0.5 } })),
      microlens: { pitch: { x: 160e-6, y: 160e-6 }, focalLength: 5e-3, apertureDiameter: 160e-6, fillFactor: 1, transmission: { front: 1, back: 1 }, offset: { x: 0, y: 0 }, rotationRad: 0, focalLengthSigma: 0, seed: 1 },
      spacing: 1e-3,
      spacingMedium: { kind: 'vacuum' },
    }
    const el = buildElement(spec, env())
    const a = uniform(), b = uniform()
    el.apply(a, 'front', NULL_CONTEXT)
    el.apply(b, 'back', NULL_CONTEXT)
    const diff = a.re.reduce((m, v, i) => Math.max(m, Math.abs(v - b.re[i]) + Math.abs(a.im[i] - b.im[i])), 0)
    expect(diff).toBeGreaterThan(1e-3)
  })
})

describe('power vs amplitude', () => {
  it('a 0.81 power reflectivity scales amplitude by 0.9', () => {
    const el = buildElement({ kind: 'mirror', id: 'm', reflectivity: { front: 0.81, back: 0.81 }, parity: 'none' }, env())
    const f = uniform()
    el.apply(f, 'front', NULL_CONTEXT)
    expect(f.re[0]).toBeCloseTo(0.9, 12)
    expect(el.powerTransmission('front')).toBe(0.81)
  })

  it('a coupler splits power into retained and tapped parts that sum to the input', () => {
    const el = buildElement({ kind: 'coupler', id: 'c', retained: { front: 0.7, back: 0.7 }, outputTap: 'out' }, env())
    const f = uniform()
    const p0 = fieldPower(f)
    let tapped = 0
    el.apply(f, 'front', { ...NULL_CONTEXT, taps: { record: (_t, g, a) => { tapped = fieldPower(g) * a * a } } })
    expect(fieldPower(f) / p0).toBeCloseTo(0.7, 12)
    expect((fieldPower(f) + tapped) / p0).toBeCloseTo(1, 12)
  })

  it('global saturable gain follows G = 1 + (G0 − 1)/(1 + Ī/I_sat)', () => {
    const el = buildElement({ kind: 'gain', id: 'g', smallSignalGain: 2, saturation: { kind: 'global', saturationIntensity: 1 }, noise: { kind: 'none' } }, env())
    const f = uniform() // mean intensity 1
    el.apply(f, 'front', NULL_CONTEXT)
    expect(el.state().gain).toBeCloseTo(1.5, 12)
    expect(f.re[0] ** 2).toBeCloseTo(1.5, 12)
  })
})

describe('pixel mapping and programs', () => {
  it('maps a 64-pixel panel onto a 128-sample grid by nearest neighbour (2 samples per pixel)', () => {
    const g: GridSpec = { nx: 128, ny: 128, dx: 31.75e-6, dy: 31.75e-6 }
    const map = buildPixelMap(g, { resolution: { x: 64, y: 64 }, pitch: { x: 63.5e-6, y: 63.5e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } })
    for (const [i, j] of [[0, 0], [1, 1], [2, 5], [127, 64], [63, 127]])
      expect(map[j * 128 + i]).toBe(Math.floor(j / 2) * 64 + Math.floor(i / 2))
  })

  it('accepts arbitrary externally supplied phase arrays pinned by hash', () => {
    const e = env()
    const store = e.assets as AssetStore
    const phase = Array.from({ length: 256 }, (_, i) => (i % 5) * 0.3)
    const ref = store.put('custom', 16, 16, phase)
    const el = buildElement(lcd({ program: { kind: 'array', ref } }), e)
    const f = uniform()
    const before = cloneField(f)
    el.apply(f, 'front', NULL_CONTEXT)
    expect(fieldPower(f)).toBeCloseTo(fieldPower(before), 12)
    expect(Math.atan2(f.im[grid.nx * 16 + 16], f.re[grid.nx * 16 + 16])).not.toBe(0)
    expect(() => buildElement(lcd({ program: { kind: 'array', ref: { ...ref, hash: 'deadbeefdeadbeef' } } }), e)).toThrow(/does not match/)
  })

  it('a live program load changes the transfer without rebuilding', () => {
    const el = buildElement(lcd(), env())
    const a = uniform()
    el.apply(a, 'front', NULL_CONTEXT)
    el.loadProgram!({ kind: 'grating', periodPx: 4, depth: 0.5, orientation: 'x' })
    const b = uniform()
    el.apply(b, 'front', NULL_CONTEXT)
    expect(b.im.some((v) => Math.abs(v) > 1e-6)).toBe(true)
    expect(a.im.every((v) => v === 0)).toBe(true)
  })
})
