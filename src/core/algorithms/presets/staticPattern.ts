import type { AlgorithmModule } from '../interfaces'
import { renderPattern, type PatternKind } from '../patterns'

interface State {
  pattern: Float64Array // amplitude per input cell
  cells: { x: number; y: number }
}

/**
 * Static optical-pattern experiment: write one pattern into the cavity and watch free evolution. No update logic —
 * the masks stay fixed and the readout reports how much of the original pattern survives.
 */
export const staticPattern: AlgorithmModule<State> = {
  id: 'static-pattern',
  name: 'Static optical pattern',
  description: 'Inject a fixed pattern once (or continuously) and observe how the recurrent optics transform it.',
  params: [
    {
      key: 'pattern', label: 'pattern', kind: 'select', default: 'smiley',
      options: (['smiley', 'text', 'token', 'gaussian', 'uniform', 'slits', 'bits'] as PatternKind[]).map((value) => ({ value, label: value })),
    },
    { key: 'text', label: 'text', kind: 'text', default: 'PHASER' },
    { key: 'token', label: 'token id', kind: 'integer', default: 3, min: 0, max: 7 },
    { key: 'seed', label: 'seed', kind: 'integer', default: 7 },
    { key: 'mode', label: 'injection', kind: 'select', default: 'pulse', options: [{ value: 'pulse', label: 'pulse at start' }, { value: 'continuous', label: 'continuous' }] },
  ],
  requirements: () => ({ regions: [], ports: [{ id: 'x', direction: 'input' }, { id: 'y', direction: 'output' }] }),
  cadence: () => Number.MAX_SAFE_INTEGER, // never updates: purely free evolution
  init(params, ctx) {
    const region = ctx.region(ctx.portRegion('x'))
    const pattern = renderPattern(params.pattern as PatternKind, {
      width: region.cells.x, height: region.cells.y, text: String(params.text), token: Number(params.token), seed: Number(params.seed),
    })
    ctx.writePort('x', pattern, params.mode === 'continuous' ? 'continuous' : 'pulse')
    return { pattern, cells: region.cells }
  },
  update: (s) => s,
  readout(s, _params, ctx) {
    const y = ctx.readPort('y')
    const target = s.pattern.map((a) => a * a)
    const n = Math.min(y.length, target.length)
    return {
      metrics: { patternCorrelation: n === target.length ? pearson(target, y) : NaN },
      grid: n === target.length ? { width: s.cells.x, height: s.cells.y, values: Array.from(y), label: 'decoded output' } : undefined,
    }
  },
  status: () => ({ phase: 'free evolution', done: false }),
}

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    sab += da * db; saa += da * da; sbb += db * db
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
}
