import { describe, expect, it } from 'vitest'
import { renderPattern } from '../src/core/algorithms/patterns'
import { createDefaultRegistry } from '../src/core/algorithms/registry'
import { Simulation } from '../src/core/runtime/simulation'
import { identityConfig, tinyConfig } from './helpers'

const registry = () => createDefaultRegistry()

describe('pure patterns', () => {
  it('render deterministically without a browser canvas', () => {
    const a = renderPattern('text', { width: 64, height: 64, text: 'Hi!' })
    const b = renderPattern('text', { width: 64, height: 64, text: 'HI!' })
    expect(a).toEqual(b)
    expect(a.some((v) => v === 1)).toBe(true)
    expect(renderPattern('smiley', { width: 32, height: 32 }).reduce((s, v) => s + v, 0)).toBeGreaterThan(20)
  })
})

describe('algorithm modules over the computational abstraction', () => {
  it('static-pattern injects its pattern through the declared input port', () => {
    const cfg = tinyConfig()
    cfg.algorithm = { module: 'static-pattern', params: { pattern: 'gaussian' } }
    const sim = new Simulation(cfg, { algorithms: registry() })
    expect(sim.pendingInputs()).toEqual([{ port: 'in', mode: 'pulse' }])
    sim.step(1)
    const snap = sim.snapshot()
    expect(snap.algorithm.error).toBeUndefined()
    expect(snap.physics.meanIntensity).toBeGreaterThan(0)
    expect(Number.isFinite(snap.algorithm.readout.metrics.patternCorrelation)).toBe(true)
  })

  it('reports unmet requirements instead of reaching into physics', () => {
    const cfg = tinyConfig()
    cfg.computation.ports = cfg.computation.ports.filter((p) => p.id !== 'y')
    cfg.algorithm = { module: 'static-pattern', params: {} }
    const sim = new Simulation(cfg, { algorithms: registry() })
    expect(sim.snapshot().algorithm.error).toMatch(/needs output port "y"/)
  })

  it('cellular memory holds bits with zero error in a lossless identity cavity', () => {
    const sim = new Simulation(identityConfig({ module: 'cellular-memory', params: { generationCycles: 10, rule: 'hold' } }), { algorithms: registry() })
    sim.step(41)
    const r = sim.snapshot().algorithm.readout
    expect(r.metrics.generation).toBe(4)
    expect(r.metrics.bitErrorRate).toBe(0)
    expect(r.vectors!.berHistory.every((b) => b === 0)).toBe(true)
  })

  it('cellular memory with a Life rule evolves deterministically', () => {
    const run = () => {
      const sim = new Simulation(identityConfig({ module: 'cellular-memory', params: { generationCycles: 3, rule: 'life', seed: 9 } }, { x: 6, y: 6 }), { algorithms: registry() })
      sim.step(31)
      return sim.snapshot().algorithm.readout.grid!.values
    }
    expect(run()).toEqual(run())
  })

  it('Hopfield relaxation recalls a single stored pattern from a corrupted cue', () => {
    const sim = new Simulation(identityConfig({ module: 'hopfield-relaxation', params: { memories: 1, corruption: 0.25, relaxCycles: 2, offLevel: 0.2 } }), { algorithms: registry() })
    sim.step(21)
    const snap = sim.snapshot()
    expect(snap.algorithm.error).toBeUndefined()
    expect(snap.algorithm.status.done).toBe(true)
    expect(Math.abs(snap.algorithm.readout.metrics.overlapWithCueSource)).toBe(1)
  })
})
