// Experiment 1b: optimise ONE static SLM program to maximise long-horizon self-overlap of a dot.
// (i) preset relay hardware (f = 40 mm): can an SLM lens make it self-imaging?  (ii) self-imaging ring with a 1 % lensR error.
// Objective: intensity correlation with the launched dot after H trips (renormalised linear evolution). 1-D scan over SLM lens power.
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { cloneField, createField, scaleField } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { slmRing } from './arch'
import { slmLensProgram } from './01-dot'
import { AssetStore } from '../../src/core/physics/assets'
import { OUT, addGaussian, compare, total, writeCsv } from './util'

// slmLensProgram registers assets in 01-dot's store; rebuild a store here with the same helper by re-putting
const H = Number(process.argv[2] ?? 100)
const sigma = 20e-6
const rows: Record<string, number | string>[] = []

function evaluate(hw: 'preset' | 'ferr1e2', power: number) {
  const program = slmLensProgram(power === 0 ? Infinity : 1 / power)
  const store = new AssetStore()
  if (program.kind === 'array') {
    // copy the asset into a local store (slmLensProgram used its own)
    const res = 64, pitch = 20e-6, lambda = 650e-9, data = new Float64Array(res * res)
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const px = (x - res / 2 + 0.5) * pitch, py = (y - res / 2 + 0.5) * pitch
      const ph = -Math.PI * (px * px + py * py) * power / lambda
      data[y * res + x] = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    }
    program.ref = store.put(program.ref.id, res, res, data)
  }
  const cfg = hw === 'preset' ? slmRing({ n: 128, focal: 40e-3, mask: program }) : slmRing({ n: 128, roof: true, focalErrorR: 1e-2, mask: program })
  const sys = new CompiledSystem(cfg, store)
  const f = createField(sys.grid)
  addGaussian(f, sigma, 60e-6, 40e-6)
  const f0 = cloneField(f), P0 = total(f)
  let best = 0, bestAt = 0
  for (let c = 1; c <= H; c++) {
    sys.roundTrip(f, NULL_CONTEXT)
    scaleField(f, Math.sqrt(P0 / total(f)))
    const k = compare(f0, f).corr
    if (c === 1 || c % 2 === 0) { if (k > best) { best = k; bestAt = c } }
  }
  const end = compare(f0, f)
  rows.push({ hardware: hw, slmPower_D: power, corrH: end.corr, fidelityH: end.fidelity, bestCorr: best, bestAt, H })
  return end.corr
}

for (const hw of ['ferr1e2', 'preset'] as const) {
  let bestP = 0, bestV = -1
  const coarse = Array.from({ length: 41 }, (_, i) => -4 + 0.2 * i) // diopters
  for (const p of coarse) { const v = evaluate(hw, p); if (v > bestV) { bestV = v; bestP = p } }
  for (let step = 0.1; step > 0.002; step /= 2) {
    for (const p of [bestP - step, bestP + step]) { const v = evaluate(hw, p); if (v > bestV) { bestV = v; bestP = p } }
  }
  console.log(`${hw}: best SLM lens power ${bestP.toFixed(4)} D (f = ${(1 / bestP).toFixed(3)} m), corr@${H} = ${bestV.toFixed(4)}; zero-mask corr@${H} = ${(rows.find((r) => r.hardware === hw && r.slmPower_D === 0)?.corrH as number)?.toFixed(4)}`)
}
writeCsv(`${OUT}01/maskopt_H${H}.csv`, rows)
