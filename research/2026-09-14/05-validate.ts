// Experiment 5 validation: direct JS evolution on the exact matrix grid, to check numpy matrix powers / eigen lifetimes.
// usage: npx vite-node 05-validate.ts <operatorName> <maxCycles>
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField, scaleField } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { OPERATORS } from './05-extract'
import { BIG, addGaussian, total, writeF64, writeJson } from './util'

const [name, maxS] = process.argv.slice(2)
const max = Number(maxS)
const sys = new CompiledSystem(OPERATORS[name](), new AssetStore())
const g = sys.grid
const f = createField(g)
// two dots of different size plus a weak broad offset component: exercises many modes
addGaussian(f, 2 * g.dx, 3 * g.dx, 2 * g.dx)
addGaussian(f, 1 * g.dx, -12 * g.dx, 9 * g.dx, 0.8, 1)
addGaussian(f, 6 * g.dx, 8 * g.dx, -10 * g.dx, 0.3, 2)
const save = (c: number) => { const a = new Float64Array(2 * f.re.length); for (let i = 0; i < f.re.length; i++) { a[2 * i] = f.re[i]; a[2 * i + 1] = f.im[i] } writeF64(`${BIG}val_${name}_c${c}.c128`, a) }
save(0)
let logE = 0
const marks = new Set([1, 10, 100, 1000, 10000, 100000, 1000000])
const t0 = performance.now()
const logs: Record<number, number> = {}
for (let c = 1; c <= max; c++) {
  const b = total(f)
  sys.roundTrip(f, NULL_CONTEXT)
  const a = total(f)
  logE += Math.log(a / b)
  scaleField(f, Math.sqrt(1 / a))
  if (marks.has(c)) { save(c); logs[c] = logE }
}
writeJson(`${BIG}val_${name}.json`, { logE: logs, seconds: (performance.now() - t0) / 1000 })
console.log(name, 'done', ((performance.now() - t0) / 1000).toFixed(1), 's')
