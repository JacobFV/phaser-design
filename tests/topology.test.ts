import { describe, expect, it } from 'vitest'
import { AssetStore } from '../src/core/physics/assets'
import { NULL_CONTEXT } from '../src/core/physics/elements/element'
import type { OpticalElementSpec } from '../src/core/physics/elements/types'
import { createField, fieldPower } from '../src/core/physics/field/grid'
import { CompiledSystem, SPEED_OF_LIGHT, type PhysicsConfig } from '../src/core/physics/system'
import { linearStack, rectangularRing } from '../src/core/physics/topology/builders'
import { compileRoute } from '../src/core/physics/topology/topology'
import { lcd } from './helpers'

const vacuum = { kind: 'vacuum' } as const
const mirror = (id: string, R = 1): OpticalElementSpec => ({ kind: 'mirror', id, reflectivity: { front: R, back: R }, parity: 'none' })

const system = (elements: OpticalElementSpec[], topology: PhysicsConfig['topology']) =>
  new CompiledSystem(
    // 32 × 20 µm window matches the 16 × 40 µm test LCD, so the panel covers the whole field
    { field: { grid: { nx: 32, ny: 32, dx: 20e-6, dy: 20e-6 }, wavelength: 650e-9, boundary: { kind: 'periodic' } }, elements, topology, readouts: [] },
    new AssetStore(),
  )

describe('ring topology', () => {
  const ring = rectangularRing({ width: 0.04, height: 0.15, medium: vacuum, corners: ['tr', 'br', 'bl', 'tl'] })

  it('defaults the left and right long legs to equal length', () => {
    const left = ring.legs.find((l) => l.id === 'left')!
    const right = ring.legs.find((l) => l.id === 'right')!
    expect(left.length).toBe(right.length)
  })

  it('computes the full perimeter as the round-trip distance', () => {
    expect(compileRoute(ring).geometricLength).toBeCloseTo(2 * 0.04 + 2 * 0.15, 12)
  })

  it('changing one side changes the round-trip time by exactly that leg', () => {
    const corners = ['tr', 'br', 'bl', 'tl'].map((id) => mirror(id))
    const a = system(corners, ring).timing()
    const b = system(corners, rectangularRing({ width: 0.04, height: 0.15, rightLength: 0.18, medium: vacuum, corners: ['tr', 'br', 'bl', 'tl'] })).timing()
    expect(b.roundTripTime - a.roundTripTime).toBeCloseTo(0.03 / SPEED_OF_LIGHT, 18)
  })

  it('enters every ring element from its front face', () => {
    const steps = compileRoute(ring).steps.filter((s) => s.kind === 'element')
    expect(steps.every((s) => s.kind === 'element' && s.side === 'front')).toBe(true)
  })
})

describe('linear reciprocal topology', () => {
  const topo = linearStack({ elementIds: ['a', 'b', 'c'], spacing: 0.01, medium: vacuum, start: ['m0'], end: ['m1'] })

  it('round-trip distance is exactly twice the one-way distance', () => {
    const route = compileRoute(topo)
    expect(route.geometricLength).toBeCloseTo(2 * topo.length, 12)
    expect(topo.length).toBeCloseTo(0.04, 12)
  })

  it('visits stack elements front-first on the way out and back-first on the way home', () => {
    const visits = compileRoute(topo).steps.flatMap((s) => (s.kind === 'element' ? [`${s.elementId}:${s.side}`] : []))
    expect(visits).toEqual(['m0:front', 'a:front', 'b:front', 'c:front', 'm1:front', 'c:back', 'b:back', 'a:back'])
  })

  it('does not use N·d_sep as the cavity length', () => {
    const t = system([mirror('m0'), mirror('m1'), ...['a', 'b', 'c'].map((id) => lcd({ id }))], topo).timing()
    expect(t.geometricLength).toBeCloseTo(2 * 4 * 0.01, 12) // (N+1)·d each way, twice
  })
})

describe('directional round trip', () => {
  it('applies the front (0.9) and back (0.5) transmission exactly once each', () => {
    const asym = lcd({ id: 'asym', surfaces: { front: { transmission: 0.9, reflection: 0.1 }, back: { transmission: 0.5, reflection: 0.5 } } })
    const sys = system([mirror('m0'), mirror('m1'), asym], {
      kind: 'linear-reciprocal', length: 0.02, medium: vacuum, start: { elementIds: ['m0'] }, end: { elementIds: ['m1'] },
      items: [{ elementId: 'asym', position: 0.01 }],
    })
    const f = createField(sys.grid)
    f.re.fill(1)
    const p0 = fieldPower(f)
    sys.roundTrip(f, NULL_CONTEXT)
    expect(fieldPower(f) / p0).toBeCloseTo(0.45, 12)
  })
})

describe('timing from the physical route', () => {
  it('round-trip frequency is the inverse of the group transit time', () => {
    const glass = { kind: 'custom', refractiveIndex: 1.45, groupIndex: 1.47, attenuationPerM: 0 } as const
    const sys = system([mirror('m0'), mirror('m1')], { kind: 'linear-reciprocal', length: 0.05, medium: glass, start: { elementIds: ['m0'] }, end: { elementIds: ['m1'] }, items: [] })
    const t = sys.timing()
    expect(t.roundTripTime).toBeCloseTo((2 * 0.05 * 1.47) / SPEED_OF_LIGHT, 18)
    expect(t.roundTripFrequency * t.roundTripTime).toBeCloseTo(1, 12)
    expect(t.opticalPathLength).toBeCloseTo(2 * 0.05 * 1.45, 12)
  })
})
