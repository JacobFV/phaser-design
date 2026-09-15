// Experiment 16: attractor basins of a designed associative-memory program, evaluated in the JS simulator.
// For each stored pattern and corruption level k (cells flipped, UNSEEN random cues), write the cue at t = 1, run T trips,
// decode the 8×8 cell pattern every 10 trips and classify the end state: recovered (Hamming ≤ 1 to the cue's source),
// other stored pattern, spurious. Convergence time = last trip at which the decoded pattern changed.
// usage: npx vite-node 16-basin.ts <spec.json> <T>
import { readFileSync } from 'node:fs'
import { mulberry32 } from '../../src/core/common/random'
import { buildSystem, runCase, type Spec } from './08-eval'
import { OUT, writeCsv, writeJson } from './util'

const [specPath, Ts] = process.argv.slice(2)
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec & { stored: Record<string, number[]>; inj_amp: number }
const T = Number(Ts ?? 3000)
const names = Object.keys(spec.cells)
const thr = 0.5 * (spec.I_hi + spec.I_lo)
const levels = [0, 2, 4, 6, 8, 12, 16, 24, 32]
const reps = 6
const r = mulberry32(2718)
const rows: Record<string, number | string>[] = []
const hamming = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0)
const t0 = performance.now()
for (const [pname, pat] of Object.entries(spec.stored)) {
  for (const k of levels) {
    for (let rep = 0; rep < reps; rep++) {
      const cue = pat.slice()
      const idx = [...cue.keys()]
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
      for (const i of idx.slice(0, k)) cue[i] = 1 - cue[i]
      // one synthetic case appended to the spec: inject the cue at t = 1
      const c = { name: `${pname}_k${k}_${rep}`, init_on: [], inject: cue.flatMap((v, i) => (v ? [{ t: 1, cell: names[i], amp: spec.inj_amp, phase: 0 }] : [])), targets: [] }
      const s2 = { ...spec, cases: [c] }
      const sys = buildSystem(s2)
      const { trace } = runCase(s2, sys, 0, T, (t) => t % 10 === 0 || t === T)
      let last: number[] = [], lastChange = 0
      for (const st of trace) {
        const dec = st.I.map((v) => (v > thr ? 1 : 0))
        if (last.length && hamming(dec, last) > 0) lastChange = st.t
        last = dec
      }
      const dists = Object.fromEntries(Object.entries(spec.stored).map(([n, p]) => [n, hamming(last, p)]))
      const nearest = Object.entries(dists).sort((a, b) => a[1] - b[1])[0]
      const outcome = dists[pname] <= 1 ? 'recovered' : nearest[1] <= 1 ? 'other_stored' : 'spurious'
      rows.push({ pattern: pname, flips: k, rep, outcome, hamming_to_source: dists[pname], nearest: nearest[0], nearest_hamming: nearest[1], converged_by: lastChange, on_cells_final: last.reduce((a, b) => a + b, 0) })
    }
    const rr = rows.filter((x) => x.pattern === pname && x.flips === k)
    console.log(`${pname} k=${k}: recovered ${rr.filter((x) => x.outcome === 'recovered').length}/${reps} other ${rr.filter((x) => x.outcome === 'other_stored').length} spurious ${rr.filter((x) => x.outcome === 'spurious').length} [${((performance.now() - t0) / 1000).toFixed(0)}s]`)
  }
}
writeCsv(`${OUT}16/basin_${spec.tag}.csv`, rows)
writeJson(`${OUT}16/basin_${spec.tag}.json`, { tag: spec.tag, T, levels, reps, stored: spec.stored, rows })
