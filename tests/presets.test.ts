import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../src/core/algorithms/registry'
import { AssetStore } from '../src/core/physics/assets'
import { CompiledSystem } from '../src/core/physics/system'
import { PRESETS, phaserChamber, reflectiveSlmRing } from '../src/core/runtime/presets'
import { exportExperiment, importExperiment } from '../src/core/runtime/serialize'
import { Simulation } from '../src/core/runtime/simulation'
import { tinyConfig } from './helpers'

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.id} is a plain serialisable config that compiles, runs and satisfies its algorithm`, () => {
      const cfg = p.build()
      expect(JSON.parse(JSON.stringify(cfg))).toEqual(cfg)
      const sim = new Simulation(cfg, { algorithms: createDefaultRegistry() })
      sim.step(2, { readouts: true })
      const snap = sim.snapshot()
      expect(snap.algorithm.error).toBeUndefined()
      expect(Number.isFinite(snap.physics.meanIntensity)).toBe(true)
      expect(snap.physics.meanIntensity).toBeGreaterThan(0)
    })
  }

  it('the PHASER chamber times its route as twice the stack length, not N·d_sep', () => {
    const t = new CompiledSystem(phaserChamber().physics, new AssetStore()).timing()
    expect(t.geometricLength).toBeCloseTo(2 * 5 * 0.01, 12)
    expect(t.roundTripFrequency).toBeGreaterThan(2.9e9)
    expect(t.roundTripFrequency).toBeLessThan(3.0e9)
  })

  it('the SLM ring enters its LCOS from the reflective front face and times the full perimeter', () => {
    const sys = new CompiledSystem(reflectiveSlmRing().physics, new AssetStore())
    expect(sys.timing().geometricLength).toBeCloseTo(0.2, 12)
    expect(sys.route.steps.find((s) => s.kind === 'element' && s.elementId === 'slm')).toMatchObject({ side: 'front' })
  })
})

describe('serialisation', () => {
  it('round-trips a config with a hash-pinned external mask', () => {
    const store = new AssetStore()
    const ref = store.put('mask-a', 16, 16, Array.from({ length: 256 }, (_, i) => Math.sin(i)))
    const cfg = tinyConfig()
    const lcd = cfg.physics.elements[1]
    if (lcd.kind === 'transmissive-lcd') lcd.program = { kind: 'array', ref }

    const embedded = exportExperiment(cfg, store, { embedAssets: true })
    const fresh = new AssetStore()
    const { config, missing } = importExperiment(embedded, fresh)
    expect(config).toEqual(cfg)
    expect(missing).toEqual([])
    expect(fresh.get(ref)).toEqual(store.get(ref))

    const bare = exportExperiment(cfg, store, { embedAssets: false })
    expect(importExperiment(bare, new AssetStore()).missing).toEqual([ref])
  })

  it('identical configs give identical results', () => {
    const run = () => {
      const s = new Simulation(JSON.parse(JSON.stringify(phaserChamber())), { algorithms: createDefaultRegistry() })
      s.step(3)
      return s.snapshot().physics.meanIntensity
    }
    expect(run()).toBe(run())
  })
})
