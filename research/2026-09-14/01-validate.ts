// throwaway: sanity of the three configurations — compact-route equivalence, warnings, timing, where a dot goes after 1 trip
import { CompiledSystem } from '../../src/core/physics/system'
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField, cloneField } from '../../src/core/physics/field/grid'
import { slmRing, linear4f, lcdMla } from './arch'
import { addGaussian, moments, compare } from './util'
import { mulberry32 } from '../../src/core/common/random'
const A = new AssetStore()
// 1. compact vs full route (A)
for (const roof of [false, true]) {
  const full = new CompiledSystem(slmRing({ n: 128, roof, compact: false, mask: { kind: 'random', seed: 3, depth: 0.1 } }), A)
  const comp = new CompiledSystem(slmRing({ n: 128, roof, compact: true, mask: { kind: 'random', seed: 3, depth: 0.1 } }), A)
  const r = mulberry32(5); const f = createField(full.grid)
  addGaussian(f, 40e-6, 60e-6, -30e-6); addGaussian(f, 15e-6, -90e-6, 50e-6, 0.7, 1.3); void r
  const g = cloneField(f)
  for (let t = 0; t < 200; t++) { full.roundTrip(f, NULL_CONTEXT); comp.roundTrip(g, NULL_CONTEXT) }
  let d = 0, s = 0
  for (let i = 0; i < f.re.length; i++) { d += (f.re[i] - g.re[i]) ** 2 + (f.im[i] - g.im[i]) ** 2; s += f.re[i] ** 2 + f.im[i] ** 2 }
  console.log(`A roof=${roof}: full vs compact after 200 trips (localized field) rel diff ${Math.sqrt(d / s).toExponential(2)} (air attenuation differs only by segment split: exact)`)
}
const cases: [string, any][] = [
  ['A f=40 (preset relay)', slmRing({ focal: 40e-3 })],
  ['A f=50 roof spp=1 (matrix grid)', slmRing({ roof: true, spp: 1 })],
  ['A f=50 (−I)', slmRing({})],
  ['A f=50 roof (+I)', slmRing({ roof: true })],
  ['B linear 4f', linear4f({})],
  ['B lensless', linear4f({ lensless: true })],
  ['C lcd+mla', lcdMla({})],
]
for (const [name, cfg] of cases) {
  for (const n of [64, 128]) {
    const sys = new CompiledSystem({ ...cfg, field: { ...cfg.field, grid: { ...cfg.field.grid, nx: n, ny: n } } }, A)
    const g = sys.grid
    const f = createField(g); addGaussian(f, 2 * g.dx, 4 * g.dx * 2, 3 * g.dx * 2)
    const f0 = cloneField(f); const m0 = moments(f)
    const t0 = performance.now(); let trips = 0
    sys.roundTrip(f, NULL_CONTEXT); trips++
    const m1 = moments(f); const c1 = compare(f0, f)
    for (; trips < 50; trips++) sys.roundTrip(f, NULL_CONTEXT)
    const ms = (performance.now() - t0) / trips
    const budget = sys.powerBudget().reduce((p, b) => p * b.transmission, 1)
    if (n === 64) console.log(`\n${name}: t_rt ${(sys.timing().roundTripTime * 1e9).toFixed(3)} ns  f_rt ${(sys.timing().roundTripFrequency / 1e9).toFixed(3)} GHz  budget(product) ${budget.toFixed(3)}  props ${sys.route.steps.filter(s=>s.kind==='propagate').length}\n  warnings: ${sys.warnings().join(' | ') || 'none'}`)
    console.log(`  n=${n} dx=${(g.dx*1e6).toFixed(2)}µm window ${(n*g.dx*1e3).toFixed(2)}mm ${ms.toFixed(2)} ms/rt | dot σ=${(2*g.dx*1e6).toFixed(0)}µm at (${(m0.cx*1e6).toFixed(0)},${(m0.cy*1e6).toFixed(0)}) → after 1 trip centroid (${(m1.cx*1e6).toFixed(0)},${(m1.cy*1e6).toFixed(0)}) σ ${(m1.sigma*1e6).toFixed(1)}µm retained ${(m1.power/m0.power).toFixed(3)} corr ${c1.corr.toFixed(3)} fid ${c1.fidelity.toFixed(3)}`)
  }
}
