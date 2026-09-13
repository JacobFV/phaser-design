import type { AlgorithmContext, AlgorithmModule } from '../interfaces'
import { mulberry32 } from '../random'

interface State {
  patterns: number[][] // stored ±1 memories
  weights: Float64Array // Hebbian N×N, zero diagonal
  spins: number[] // current ±1 estimate
  iteration: number
  energy: number[]
  converged: boolean
}

/**
 * Recurrent relaxation toward an attractor (Hopfield-style associative memory).
 * A corrupted cue is written into the cavity. Every `relaxCycles` round trips the controller decodes the optical state
 * into spins, applies one synchronous update s ← sign(W s) and rewrites the result. Converges to a stored memory
 * (or a spurious attractor).
 *
 * Honest division of labour: the optics hold and transform the state between updates; W·s is computed electronically.
 * The module exists to exercise the relaxation/attractor interface, not to claim optical associative recall.
 */
export const hopfieldRelaxation: AlgorithmModule<State> = {
  id: 'hopfield-relaxation',
  name: 'Attractor relaxation (Hopfield)',
  description: 'Recall a stored binary pattern from a corrupted cue by recurrent relaxation between optical hold periods.',
  params: [
    { key: 'memories', label: 'stored patterns', kind: 'integer', default: 3, min: 1, max: 8 },
    { key: 'corruption', label: 'cue corruption', kind: 'number', default: 0.2, min: 0, max: 0.5, step: 0.01 },
    { key: 'relaxCycles', label: 'cycles per update', kind: 'integer', default: 10, min: 1 },
    { key: 'offLevel', label: 'amplitude for −1', kind: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },
    { key: 'seed', label: 'seed', kind: 'integer', default: 11 },
  ],
  requirements: () => ({ regions: [], ports: [{ id: 'write', direction: 'input' }, { id: 'read', direction: 'output' }] }),
  cadence: (p) => Math.max(1, Number(p.relaxCycles)),
  init(p, ctx) {
    const cells = ctx.region(ctx.portRegion('write')).cells
    const n = cells.x * cells.y
    const rand = mulberry32(Number(p.seed))
    const patterns = Array.from({ length: Number(p.memories) }, () => Array.from({ length: n }, () => (rand() < 0.5 ? -1 : 1)))
    const weights = new Float64Array(n * n)
    for (const pat of patterns)
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) weights[i * n + j] += (pat[i] * pat[j]) / n
    const spins = patterns[0].map((s) => (rand() < Number(p.corruption) ? -s : s))
    write(ctx, spins, Number(p.offLevel))
    return { patterns, weights, spins, iteration: 0, energy: [energyOf(weights, spins)], converged: false }
  },
  update(s, p, ctx) {
    if (s.converged) return s
    const observed = decodeSpins(ctx)
    const n = observed.length
    const next = observed.map((_, i) => {
      let h = 0
      for (let j = 0; j < n; j++) h += s.weights[i * n + j] * observed[j]
      return h >= 0 ? 1 : -1
    })
    const converged = next.every((v, i) => v === observed[i])
    ctx.requestFieldReset()
    write(ctx, next, Number(p.offLevel))
    return { ...s, spins: next, iteration: s.iteration + 1, energy: [...s.energy, energyOf(s.weights, next)].slice(-200), converged }
  },
  readout(s, _p, ctx) {
    const cells = ctx.region(ctx.portRegion('read')).cells
    const n = s.spins.length
    const overlaps = s.patterns.map((pat) => pat.reduce((a, v, i) => a + v * s.spins[i], 0) / n)
    return {
      metrics: {
        iteration: s.iteration,
        energy: s.energy[s.energy.length - 1],
        overlapWithCueSource: overlaps[0],
        bestOverlap: Math.max(...overlaps.map(Math.abs)),
        converged: s.converged ? 1 : 0,
      },
      vectors: { energy: s.energy, overlaps },
      grid: { width: cells.x, height: cells.y, values: s.spins.map((v) => (v + 1) / 2), label: 'current spins' },
    }
  },
  status: (s) => ({ phase: s.converged ? 'converged' : `relaxing (iteration ${s.iteration})`, done: s.converged }),
}

function write(ctx: AlgorithmContext, spins: number[], off: number) {
  ctx.writePort('write', spins.map((v) => (v > 0 ? 1 : off)), 'pulse')
}

/** Midpoint between the darkest and brightest cell: robust to any ±1 balance (a median split is not). */
function decodeSpins(ctx: AlgorithmContext): number[] {
  const v = Array.from(ctx.readPort('read'))
  const threshold = (Math.min(...v) + Math.max(...v)) / 2
  return v.map((x) => (x > threshold ? 1 : -1))
}

function energyOf(w: Float64Array, s: number[]): number {
  const n = s.length
  let e = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) e -= 0.5 * w[i * n + j] * s[i] * s[j]
  return e
}
