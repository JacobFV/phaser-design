import type { AlgorithmContext, AlgorithmModule } from '../interfaces'
import { mulberry32 } from '../random'

interface State {
  target: boolean[] // the logical state the optics should currently hold
  decoded: number[] // last normalised readout
  generation: number
  berHistory: number[]
  contrast: number
}

/**
 * Persistent cellular / logical state. Bits live as light in spatial cells; every `generationCycles` round trips the
 * slow controller reads the cells, scores retention against the intended state, optionally applies a cellular rule
 * (computed electronically at that cadence) and writes the next state back.
 *
 * Honest division of labour: the optics provide the persistent state; the rule is not performed optically.
 */
export const cellularMemory: AlgorithmModule<State> = {
  id: 'cellular-memory',
  name: 'Persistent cellular state',
  description: 'Hold bits as light in cells; measure bit-error rate over recurrence; optionally step a Game-of-Life rule at a slow cadence.',
  params: [
    { key: 'seed', label: 'seed', kind: 'integer', default: 5 },
    { key: 'density', label: 'on fraction', kind: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
    { key: 'threshold', label: 'threshold (× max)', kind: 'number', default: 0.35, min: 0.01, max: 0.99, step: 0.01 },
    { key: 'generationCycles', label: 'cycles per generation', kind: 'integer', default: 20, min: 1 },
    {
      key: 'rule', label: 'rule', kind: 'select', default: 'hold',
      options: [{ value: 'hold', label: 'hold (memory test)' }, { value: 'life', label: 'Game of Life' }],
    },
    { key: 'rewrite', label: 'rewrite each generation', kind: 'boolean', default: false },
  ],
  requirements: () => ({ regions: [], ports: [{ id: 'write', direction: 'input' }, { id: 'read', direction: 'output' }] }),
  cadence: (p) => Math.max(1, Number(p.generationCycles)),
  init(p, ctx) {
    const cells = ctx.region(ctx.portRegion('write')).cells
    const rand = mulberry32(Number(p.seed))
    const target = Array.from({ length: cells.x * cells.y }, () => rand() < Number(p.density))
    write(ctx, target)
    return { target, decoded: [], generation: 0, berHistory: [], contrast: 0 }
  },
  update(s, p, ctx) {
    const { bits, norm, contrast } = decode(ctx, s.target, Number(p.threshold))
    const ber = bits.reduce((e, b, i) => e + (b !== s.target[i] ? 1 : 0), 0) / bits.length
    let target = s.target
    if (p.rule === 'life') target = lifeStep(bits, ctx.region(ctx.portRegion('read')).cells)
    if (p.rule === 'life' || p.rewrite) {
      ctx.requestFieldReset() // overwrite rather than superpose the next generation
      write(ctx, target)
    }
    return { target, decoded: norm, generation: s.generation + 1, berHistory: [...s.berHistory, ber].slice(-200), contrast }
  },
  readout(s, p, ctx) {
    const cells = ctx.region(ctx.portRegion('read')).cells
    const { norm, contrast, bits } = decode(ctx, s.target, Number(p.threshold))
    const ber = bits.reduce((e, b, i) => e + (b !== s.target[i] ? 1 : 0), 0) / Math.max(1, bits.length)
    return {
      metrics: { generation: s.generation, bitErrorRate: ber, contrast },
      vectors: { berHistory: s.berHistory },
      grid: { width: cells.x, height: cells.y, values: norm, label: 'decoded cells (normalised)' },
    }
  },
  status: (s) => ({ phase: `generation ${s.generation}`, done: false }),
}

function write(ctx: AlgorithmContext, bits: boolean[]) {
  ctx.writePort('write', bits.map((b) => (b ? 1 : 0)), 'pulse')
}

function decode(ctx: AlgorithmContext, target: boolean[], threshold: number) {
  const v = Array.from(ctx.readPort('read'))
  const max = Math.max(...v, 1e-300)
  const norm = v.map((x) => x / max)
  const bits = norm.map((x) => x > threshold)
  let on = 0, off = 0, nOn = 0, nOff = 0
  target.forEach((t, i) => (t ? ((on += norm[i]), nOn++) : ((off += norm[i]), nOff++)))
  const contrast = nOn && nOff && off > 0 ? on / nOn / (off / nOff) : Infinity
  return { bits, norm, contrast }
}

function lifeStep(bits: boolean[], cells: { x: number; y: number }): boolean[] {
  const at = (x: number, y: number) => bits[((y + cells.y) % cells.y) * cells.x + ((x + cells.x) % cells.x)]
  return bits.map((alive, i) => {
    const x = i % cells.x, y = Math.floor(i / cells.x)
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy)) n++
    return alive ? n === 2 || n === 3 : n === 3
  })
}
