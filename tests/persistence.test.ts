import { describe, expect, it } from 'vitest'
import { cloneField } from '../src/core/physics/field/grid'
import { Simulation } from '../src/core/runtime/simulation'
import { pattern, tinyConfig } from './helpers'

const maxDiff = (a: Float64Array, b: Float64Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0)

describe('state lifecycle', () => {
  it('injecting a second input superposes onto the live optical state instead of resetting it', () => {
    const both = new Simulation(tinyConfig())
    both.writePort('x', pattern(1), 'pulse')
    both.step(3)
    both.writePort('x', pattern(2), 'pulse')
    both.step(2)
    expect(both.cycle).toBe(5)

    const first = new Simulation(tinyConfig())
    first.writePort('x', pattern(1), 'pulse')
    first.step(5)

    const second = new Simulation(tinyConfig())
    second.step(3)
    second.writePort('x', pattern(2), 'pulse')
    second.step(2)

    // the cavity is linear, so the combined state is exactly the sum of the two histories
    const f = both.currentField, a = first.currentField, b = second.currentField
    const sumRe = a.re.map((v, i) => v + b.re[i])
    const sumIm = a.im.map((v, i) => v + b.im[i])
    expect(maxDiff(f.re, sumRe)).toBeLessThan(1e-12)
    expect(maxDiff(f.im, sumIm)).toBeLessThan(1e-12)
  })

  it('changing a live mask with preservation keeps time and optical state', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(3), 'pulse')
    sim.step(4)
    const before = cloneField(sim.currentField)
    const epoch = sim.snapshot().epoch
    sim.setProgram('lcd', { kind: 'grating', periodPx: 4, depth: 0.5, orientation: 'diagonal' })
    expect(sim.cycle).toBe(4)
    expect(sim.snapshot().epoch).toBe(epoch)
    expect(maxDiff(sim.currentField.re, before.re)).toBe(0)
    sim.step(1)
    expect(sim.cycle).toBe(5)
  })

  it('a program-only config edit loads into the device without a reset', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(4), 'pulse')
    sim.step(2)
    const next = tinyConfig()
    const lcdSpec = next.physics.elements[1]
    if (lcdSpec.kind === 'transmissive-lcd') lcdSpec.program = { kind: 'random', seed: 99, depth: 0.1 }
    const { change, applied } = sim.configure(next)
    expect(change.programUpdates).toEqual(['lcd'])
    expect(change.recompilePhysics).toBe(false)
    expect(applied).toEqual([])
    expect(sim.cycle).toBe(2)
  })

  it('an element parameter edit rebuilds operators but keeps the field', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(5), 'pulse')
    sim.step(2)
    const before = cloneField(sim.currentField)
    const next = tinyConfig()
    next.physics.topology = { ...next.physics.topology, length: 0.03 } as typeof next.physics.topology
    const { change, applied } = sim.configure(next)
    expect(change.recompilePhysics).toBe(true)
    expect(applied).toEqual([])
    expect(maxDiff(sim.currentField.re, before.re)).toBe(0)
  })

  it('changing the transverse grid requires a physical reset', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(6), 'pulse')
    sim.step(2)
    const next = tinyConfig()
    next.physics.field.grid = { nx: 64, ny: 64, dx: 10e-6, dy: 10e-6 }
    const { applied } = sim.configure(next)
    expect(applied).toContain('physical-field')
    expect(sim.cycle).toBe(0)
  })

  it('an explicit physical reset clears the field, time and pending inputs', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(7), 'continuous')
    sim.step(3)
    const epoch = sim.snapshot().epoch
    sim.reset('physical-field')
    expect(sim.cycle).toBe(0)
    expect(sim.time).toBe(0)
    expect(sim.currentField.re.every((v) => v === 0)).toBe(true)
    expect(sim.pendingInputs()).toEqual([])
    expect(sim.snapshot().epoch).toBe(epoch + 1)
  })

  it('continuous injection persists across cycles until stopped', () => {
    const sim = new Simulation(tinyConfig())
    sim.writePort('x', pattern(8), 'continuous')
    sim.step(5)
    const e5 = sim.snapshot().physics.meanIntensity
    sim.stopPort('x')
    expect(sim.pendingInputs()).toEqual([])
    expect(e5).toBeGreaterThan(0)
  })
})

describe('observation never alters results', () => {
  it('side views, step fields and probes leave the evolution bit-identical', () => {
    const plain = new Simulation(tinyConfig())
    const watched = new Simulation(tinyConfig())
    for (const s of [plain, watched]) s.writePort('x', pattern(9), 'pulse')
    plain.step(6)
    watched.step(6, { sideView: { samplesPerSegment: 5 }, stepFields: [0, 1, 2, 3], probe: { stepIndex: 1, fraction: 0.4 }, captureField: true, taps: true, readouts: true })
    const snap = watched.snapshot()
    expect(snap.physics.sideView?.segments.length).toBeGreaterThan(0)
    expect(snap.physics.probe).toBeDefined()
    expect(maxDiff(plain.currentField.re, watched.currentField.re)).toBe(0)
    expect(maxDiff(plain.currentField.im, watched.currentField.im)).toBe(0)
  })
})
