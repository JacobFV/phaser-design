import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, characterize, traceAndEvaluate, type CharacterizationRequest } from '../src/core/computation/analysis/characterize'
import { AssetStore } from '../src/core/physics/assets'
import { CompiledSystem, type PhysicsConfig } from '../src/core/physics/system'

const loose = { ...DEFAULT_THRESHOLDS, maxLeakage: 1, maxCrosstalk: 1, maxWidthDriftPerCycle: 1, maxCentroidDriftPerCycle: 1 }

/** Lossless identity route: no propagation, one ideal mirror. */
const identity: PhysicsConfig = {
  field: { grid: { nx: 64, ny: 64, dx: 20e-6, dy: 20e-6 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.05 } },
  elements: [{ kind: 'mirror', id: 'm', reflectivity: { front: 1, back: 1 }, parity: 'none' }],
  topology: { kind: 'custom', route: [{ kind: 'element', elementId: 'm', side: 'front' }] },
  readouts: [],
}

/** Free-space linear cavity: 5 mm each way, ideal mirrors, so diffraction is the only effect. */
const diffusive: PhysicsConfig = {
  field: { grid: { nx: 64, ny: 64, dx: 20e-6, dy: 20e-6 }, wavelength: 650e-9, boundary: { kind: 'periodic' } },
  elements: [
    { kind: 'mirror', id: 'a', reflectivity: { front: 1, back: 1 }, parity: 'none' },
    { kind: 'mirror', id: 'b', reflectivity: { front: 1, back: 1 }, parity: 'none' },
  ],
  topology: { kind: 'linear-reciprocal', length: 0.005, medium: { kind: 'vacuum' }, start: { elementIds: ['a'] }, end: { elementIds: ['b'] }, items: [] },
  readouts: [],
}

const req = (over: Partial<CharacterizationRequest> = {}): CharacterizationRequest => ({
  sigmas: [30e-6, 150e-6], separations: [200e-6, 400e-6], horizons: [1, 20], thresholds: loose, ...over,
})

describe('blob characterisation', () => {
  it('an identity / lossless route preserves blob width exactly', () => {
    const trial = traceAndEvaluate(new CompiledSystem(identity, new AssetStore()), 60e-6, req({ horizons: [25] }))
    const s = trial.trace.sigma
    expect(Math.abs(s[s.length - 1] / s[0] - 1)).toBeLessThan(1e-12)
    expect(trial.horizons[0].correlation).toBeCloseTo(1, 12)
    expect(trial.drift.widthPerCycle).toBeLessThan(1e-12)
  })

  it('free-space diffraction increases the width of a narrow blob', () => {
    const trial = traceAndEvaluate(new CompiledSystem(diffusive, new AssetStore()), 30e-6, req({ horizons: [5] }))
    expect(trial.horizons[0].sigmaRatio).toBeGreaterThan(1.5)
  })

  it('minimum-stable-width search is deterministic for deterministic physics', () => {
    const r = req({ sigmas: [30e-6, 80e-6, 150e-6], horizons: [1, 10] })
    const a = characterize(diffusive, new AssetStore(), r)
    const b = characterize(diffusive, new AssetStore(), r)
    expect(a.minStableSigma).toBe(b.minStableSigma)
    expect(a.transient).toEqual(b.transient)
  })

  it('transient horizons separate short-lived from long-lived states', () => {
    const res = characterize(diffusive, new AssetStore(), req())
    const narrow = res.trials.find((t) => t.sigma === 30e-6)!
    const wide = res.trials.find((t) => t.sigma === 150e-6)!
    const at = (t: typeof narrow, h: number) => t.horizons.find((x) => x.horizon === h)!.survivesShape
    expect(at(narrow, 1)).toBe(true)
    expect(at(narrow, 20)).toBe(false)
    expect(at(wide, 20)).toBe(true)
    // transient density at the short horizon uses the narrow blob; at the long horizon only the wide one qualifies
    expect(res.transient.find((d) => d.horizon === 1)!.minSigma).toBe(30e-6)
    expect(res.transient.find((d) => d.horizon === 20)!.minSigma).toBe(150e-6)
  })

  it('reports a linear eigenmode estimate separately from the numerical results', () => {
    const res = characterize(diffusive, new AssetStore(), req({ sigmas: [150e-6], horizons: [10] }))
    expect(res.kind).toBe('numerical')
    expect(res.asymptotic.kind).toBe('asymptotic')
    expect(res.asymptotic.available).toBe(true)
    expect(res.asymptotic.eigenvalue).toBeCloseTo(1, 6) // lossless
  })
})
