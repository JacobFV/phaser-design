import { describe, expect, it } from 'vitest'
import { fft2 } from '../src/core/physics/field/fft'
import { cloneField, createField, fieldPower, multiplyPhase, type GridSpec } from '../src/core/physics/field/grid'
import { resolveMedium } from '../src/core/physics/media/media'
import { KernelCache, buildKernel, propagate } from '../src/core/physics/propagation/angularSpectrum'
import { mulberry32 } from '../src/core/common/random'

const grid: GridSpec = { nx: 32, ny: 32, dx: 10e-6, dy: 10e-6 }
const lambda = 650e-9

function randomField(seed = 1) {
  const f = createField(grid)
  const r = mulberry32(seed)
  for (let i = 0; i < f.re.length; i++) {
    f.re[i] = r() - 0.5
    f.im[i] = r() - 0.5
  }
  return f
}

const maxDiff = (a: Float64Array, b: Float64Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0)

describe('field transforms', () => {
  it('fft2 followed by its inverse is the identity', () => {
    const f = randomField()
    const g = cloneField(f)
    fft2(g)
    fft2(g, true)
    expect(maxDiff(f.re, g.re)).toBeLessThan(1e-12)
    expect(maxDiff(f.im, g.im)).toBeLessThan(1e-12)
  })

  it('supports rectangular grids', () => {
    const f = createField({ nx: 64, ny: 16, dx: 1e-5, dy: 2e-5 })
    f.re[5] = 1
    const g = cloneField(f)
    fft2(g)
    fft2(g, true)
    expect(maxDiff(f.re, g.re)).toBeLessThan(1e-12)
  })
})

describe('angular-spectrum propagation', () => {
  const vacuum = resolveMedium({ kind: 'vacuum' }, lambda)

  it('zero-distance propagation preserves the field', () => {
    const f = randomField()
    const g = cloneField(f)
    propagate(g, buildKernel(grid, lambda, 0, vacuum))
    expect(maxDiff(f.re, g.re)).toBeLessThan(1e-12)
    expect(maxDiff(f.im, g.im)).toBeLessThan(1e-12)
  })

  it('vacuum propagation has unity power transmission', () => {
    const f = randomField(2)
    const p0 = fieldPower(f)
    propagate(f, buildKernel(grid, lambda, 0.1, vacuum))
    expect(fieldPower(f) / p0).toBeCloseTo(1, 12)
  })

  it('an absorbing medium removes power as exp(−αL)', () => {
    const medium = resolveMedium({ kind: 'custom', refractiveIndex: 1.33, attenuationPerM: 3 }, lambda)
    const f = randomField(3)
    const p0 = fieldPower(f)
    propagate(f, buildKernel(grid, lambda, 0.2, medium))
    expect(fieldPower(f) / p0).toBeCloseTo(Math.exp(-0.6), 10)
  })

  it('a unit-transmission phase mask changes phase but not power', () => {
    const f = randomField(4)
    const before = cloneField(f)
    const phase = new Float64Array(f.re.length).map((_, i) => (i % 7) * 0.9)
    multiplyPhase(f, phase)
    expect(fieldPower(f)).toBeCloseTo(fieldPower(before), 12)
    expect(maxDiff(f.re, before.re)).toBeGreaterThan(1e-3)
  })

  it('caches kernels for identical segments', () => {
    const cache = new KernelCache()
    const a = cache.get(grid, lambda, 0.01, vacuum)
    const b = cache.get(grid, lambda, 0.01, vacuum)
    cache.get(grid, lambda, 0.02, vacuum)
    expect(a).toBe(b)
    expect(cache.size).toBe(2)
  })
})

describe('media', () => {
  it('standard air has n − 1 ≈ 2.76e-4 at 650 nm and a larger group index', () => {
    const air = resolveMedium({ kind: 'air', pressurePa: 101325, temperatureK: 288.15, attenuationPerM: 0 }, lambda)
    expect(air.n - 1).toBeGreaterThan(2.7e-4)
    expect(air.n - 1).toBeLessThan(2.8e-4)
    expect(air.ng).toBeGreaterThan(air.n)
  })

  it('refractivity of a gas scales with density', () => {
    const at = (p: number) => resolveMedium({ kind: 'gas', gas: 'nitrogen', pressurePa: p, temperatureK: 273.15, attenuationPerM: 0 }, lambda).n - 1
    expect(at(50662.5) / at(101325)).toBeCloseTo(0.5, 10)
  })
})
