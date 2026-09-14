import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../src/core/algorithms/registry'
import { AssetStore } from '../src/core/physics/assets'
import { Simulation } from '../src/core/runtime/simulation'
import { snapshotTransferables } from '../src/core/runtime/snapshots'
import { monochromeRGB } from '../src/presentation/color/spectrum'
import { tinyConfig } from './helpers'

/** The worker transfers snapshot buffers to the UI; a second snapshot of the same round trip must not reuse them. */
describe('snapshot buffers survive being transferred', () => {
  it('consecutive snapshots never share an ArrayBuffer, even without a step in between', () => {
    const sim = new Simulation(tinyConfig(), { assets: new AssetStore(), algorithms: createDefaultRegistry() })
    sim.step(1, { sideView: { samplesPerSegment: 3 }, stepFields: [0, 1], probe: { stepIndex: 1, fraction: 0.5 }, readouts: true, taps: true })
    const first = new Set(snapshotTransferables(sim.snapshot()))
    expect(first.size).toBeGreaterThan(3)
    // configure without a reset re-snapshots the same recorded round trip (this is what raised the detached-buffer error)
    sim.configure(sim.config, {})
    const second = snapshotTransferables(sim.snapshot())
    for (const b of second) expect(first.has(b)).toBe(false)
  })

  it('a transferred (detached) buffer is not handed out again', () => {
    const sim = new Simulation(tinyConfig(), { assets: new AssetStore(), algorithms: createDefaultRegistry() })
    sim.step(1, { sideView: { samplesPerSegment: 2 }, stepFields: [1] })
    const a = sim.snapshot()
    // emulate the worker transfer: structuredClone with a transfer list detaches the source buffers
    structuredClone(a, { transfer: snapshotTransferables(a) })
    expect(a.physics.stepFields[1].byteLength).toBe(0)
    const b = sim.snapshot()
    expect(b.physics.stepFields[1].byteLength).toBeGreaterThan(0)
    expect(() => structuredClone(b, { transfer: snapshotTransferables(b) })).not.toThrow()
  })
})

describe('spectral display colour', () => {
  it('maps visible lines to the expected sRGB hues', () => {
    const hue = (nm: number) => monochromeRGB(nm * 1e-9)
    const [r650, g650, b650] = hue(650)
    expect(r650).toBeCloseTo(1, 5)
    expect(g650).toBeLessThan(0.2)
    expect(b650).toBeLessThan(0.2)
    const [r532, g532] = hue(532)
    expect(g532).toBeCloseTo(1, 5)
    expect(r532).toBeLessThan(g532)
    const [r450, , b450] = hue(450)
    expect(b450).toBeCloseTo(1, 5)
    expect(r450).toBeLessThan(b450)
    const [r580, g580, b580] = hue(580) // yellow: red and green both high, blue low
    expect(Math.min(r580, g580)).toBeGreaterThan(0.7)
    expect(b580).toBeLessThan(0.3)
  })
})
