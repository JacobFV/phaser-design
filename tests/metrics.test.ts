import { describe, expect, it } from 'vitest'
import { AssetStore } from '../src/core/physics/assets'
import { NULL_CONTEXT } from '../src/core/physics/elements/element'
import { createField, fieldPower } from '../src/core/physics/field/grid'
import { analyticMetrics } from '../src/core/physics/metrics/analytic'
import { CompiledSystem, type PhysicsConfig } from '../src/core/physics/system'
import { lcd } from './helpers'

const lossy: PhysicsConfig = {
  field: { grid: { nx: 32, ny: 32, dx: 20e-6, dy: 20e-6 }, wavelength: 650e-9, boundary: { kind: 'periodic' } },
  elements: [
    { kind: 'coupler', id: 'c', retained: { front: 0.9, back: 0.9 } },
    { kind: 'mirror', id: 'm', reflectivity: { front: 0.81, back: 0.81 }, parity: 'none' },
    lcd({ id: 'lcd' }),
  ],
  topology: { kind: 'linear-reciprocal', length: 0.02, medium: { kind: 'vacuum' }, start: { elementIds: ['c'] }, end: { elementIds: ['m'] }, items: [{ elementId: 'lcd', position: 0.01 }] },
  readouts: [],
}

const get = (sys: CompiledSystem, key: string) => analyticMetrics(sys).find((m) => m.key === key)!

describe('metrics', () => {
  it('analytic passive retention matches the numerically measured round-trip power', () => {
    const sys = new CompiledSystem(lossy, new AssetStore())
    const f = createField(sys.grid)
    f.re.fill(1)
    const p0 = fieldPower(f)
    sys.roundTrip(f, NULL_CONTEXT)
    expect(get(sys, 'passiveRetention').value).toBeCloseTo(0.9 * 0.81, 12)
    expect(fieldPower(f) / p0).toBeCloseTo(get(sys, 'passiveRetention').value, 12)
  })

  it('round-trip frequency is the inverse of transit time', () => {
    const sys = new CompiledSystem(lossy, new AssetStore())
    expect(get(sys, 'roundTripFrequency').value * get(sys, 'roundTripTime').value).toBeCloseTo(1, 12)
  })

  it('distinguishes samples, modulator pixels and effective modes, and never reports FLOPs', () => {
    const sys = new CompiledSystem(lossy, new AssetStore())
    const ms = analyticMetrics(sys)
    expect(get(sys, 'physicalSamples').value).toBe(1024)
    expect(get(sys, 'modulatorPixels').value).toBe(256)
    expect(get(sys, 'effectiveModes').value).not.toBe(get(sys, 'physicalSamples').value)
    expect(ms.every((m) => !/flop/i.test(m.key + m.label) && ['analytical', 'numerical', 'asymptotic'].includes(m.kind))).toBe(true)
  })

  it('depends only on the physics configuration, not on any presentation object', () => {
    const a = analyticMetrics(new CompiledSystem(lossy, new AssetStore()))
    const decorated = { ...structuredClone(lossy), presentation: { zoom: 3, colors: ['#fff'] } } as PhysicsConfig
    const b = analyticMetrics(new CompiledSystem(decorated, new AssetStore()))
    expect(b).toEqual(a)
  })
})
