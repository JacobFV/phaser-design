// Physical behaviour of the PHASER chamber preset, checked against closed-form expectations on the generic engine.
import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../src/core/algorithms/registry'
import { AssetStore } from '../src/core/physics/assets'
import { analyticMetrics } from '../src/core/physics/metrics/analytic'
import { CompiledSystem, SPEED_OF_LIGHT } from '../src/core/physics/system'
import { phaserChamber } from '../src/core/runtime/presets'
import { Simulation } from '../src/core/runtime/simulation'

const run = (cycles: number) => {
  const sim = new Simulation(phaserChamber(), { algorithms: createDefaultRegistry() })
  sim.step(cycles)
  return sim
}

describe('PHASER chamber preset', () => {
  it('traverses 4 LCD planes forward (front faces) and back (back faces) between the two couplers', () => {
    const sys = new CompiledSystem(phaserChamber().physics, new AssetStore())
    const visits = sys.route.steps.flatMap((s) => (s.kind === 'element' ? [`${s.elementId}:${s.side}`] : []))
    expect(visits).toEqual([
      'in:front', 'lcd1:front', 'lcd2:front', 'lcd3:front', 'lcd4:front',
      'out:front', 'gain:front', 'kerr:front',
      'lcd4:back', 'lcd3:back', 'lcd2:back', 'lcd1:back',
    ])
    expect(sys.route.steps.filter((s) => s.kind === 'propagate')).toHaveLength(10)
  })

  it('round-trip time is 2·(N+1)·d_sep·n_g/c of air', () => {
    const t = new CompiledSystem(phaserChamber().physics, new AssetStore()).timing()
    expect(t.geometricLength).toBeCloseTo(0.1, 12)
    expect(t.groupPathLength / t.geometricLength).toBeGreaterThan(1.00027)
    expect(t.roundTripTime).toBeCloseTo(t.groupPathLength / SPEED_OF_LIGHT, 18)
  })

  it('saturable gain settles where G_eff equals the inverse passive round-trip retention', () => {
    // periodic boundary + phase-only masks: the only losses are the analytic ones, so equilibrium is exact
    const sim = run(80)
    const passive = analyticMetrics(sim.system).find((m) => m.key === 'passiveRetention')!.value
    expect(sim.snapshot().physics.elementStates.gain.gain).toBeCloseTo(1 / passive, 3)
  })

  it('side-view projections conserve the mean intensity of the full 2-D field', () => {
    const sim = new Simulation(phaserChamber(), { algorithms: createDefaultRegistry() })
    sim.step(3, { sideView: { samplesPerSegment: 4 } })
    const snap = sim.snapshot()
    const route = snap.physics.route
    const last = route.steps.length - 1
    const proj = snap.physics.sideView!.after[last]
    const projMean = proj.I.reduce((s, v) => s + v, 0) / proj.I.length
    // projections are float32 snapshots: agreement is limited to single precision
    expect(Math.abs(projMean / snap.physics.meanIntensity - 1)).toBeLessThan(1e-6)
  })

  it('is deterministic and reads out through M_out onto the Fourier-plane detector', () => {
    const a = run(4).snapshot()
    const b = run(4).snapshot()
    expect(a.physics.meanIntensity).toBe(b.physics.meanIntensity)
    const sim = run(1)
    sim.step(1, { readouts: true })
    const img = sim.snapshot().physics.readouts[0]
    expect(img.id).toBe('ccd')
    expect(img.power).toBeGreaterThan(0)
  })
})
