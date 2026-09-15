// Validity check: does high-angle light scattered by pixel-scale phase structure wrap around the FFT window instead of being
// absorbed? Compare moat-cell retention and random-mask retention for (i) compact route 64² (window 1.28 mm), (ii) compact
// route 256² spp 1 (window 5.12 mm), (iii) 64² with ≤10 mm propagation steps, (iv) 256² with ≤10 mm steps.
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField, sampleX, sampleY } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { slmRing } from './arch'
import { OUT, total, writeJson } from './util'
const res: Record<string, unknown>[] = []
for (const pattern of ['zero', 'moat', 'random', 'checker_all']) {
  for (const [label, n, maxStep] of [['64 compact', 64, 0], ['256 compact', 256, 0], ['64 step10mm', 64, 10e-3], ['256 step10mm', 256, 10e-3], ['64 step2mm', 64, 2e-3]] as const) {
    const store = new AssetStore()
    const resPx = n // spp 1: one pixel per sample, panel covers the window
    const data = new Float64Array(resPx * resPx)
    for (let y = 0; y < resPx; y++) for (let x = 0; x < resPx; x++) {
      const px = (x - resPx / 2 + 0.5) * 20e-6, py = (y - resPx / 2 + 0.5) * 20e-6
      const inCell = Math.abs(px) < 30e-6 && Math.abs(py) < 30e-6
      if (pattern === 'moat') data[y * resPx + x] = inCell ? 0 : ((x + y) % 2) * Math.PI
      if (pattern === 'checker_all') data[y * resPx + x] = ((x + y) % 2) * Math.PI
      if (pattern === 'random') data[y * resPx + x] = 2 * Math.PI * ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1
    }
    const cfg = slmRing({ n, spp: 1, roof: true, maxStep: maxStep || undefined, mask: pattern === 'zero' ? { kind: 'zero' } : { kind: 'array', ref: store.put('m', resPx, resPx, data) } })
    const sys = new CompiledSystem(cfg, store)
    const f = createField(sys.grid)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = sampleX(sys.grid, i), y = sampleY(sys.grid, j)
      if (Math.abs(x) < 30e-6 && Math.abs(y) < 30e-6) f.re[j * n + i] = 1
    }
    const cellPow = () => { let s = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = sampleX(sys.grid, i), y = sampleY(sys.grid, j); if (Math.abs(x) < 30e-6 && Math.abs(y) < 30e-6) s += f.re[j * n + i] ** 2 + f.im[j * n + i] ** 2 } return s }
    const P0 = total(f), C0 = cellPow()
    const t0 = performance.now()
    const tr: number[] = [], cr: number[] = []
    for (let t = 1; t <= 20; t++) { sys.roundTrip(f, NULL_CONTEXT); tr.push(total(f) / P0); cr.push(cellPow() / C0) }
    const r = { pattern, label, n, maxStep, props: sys.route.steps.filter((s) => s.kind === 'propagate').length, ms_per_trip: (performance.now() - t0) / 20, total_1: tr[0], total_5: tr[4], total_20: tr[19], cell_1: cr[0], cell_5: cr[4], cell_20: cr[19] }
    res.push(r)
    console.log(`${pattern.padEnd(12)} ${label.padEnd(13)} props ${String(r.props).padStart(3)} ${r.ms_per_trip.toFixed(1)}ms  total retained after 1/5/20 trips ${tr[0].toFixed(4)} ${tr[4].toExponential(3)} ${tr[19].toExponential(3)} | cell ${cr[0].toFixed(4)} ${cr[4].toExponential(3)} ${cr[19].toExponential(3)}`)
  }
}
writeJson(`${OUT}01/wrap_check.json`, res)
