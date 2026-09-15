// JS re-evaluation of a designed static program (spec from 08-design.py) in the actual simulator, over long horizons.
// usage: npx vite-node 08-eval.ts <spec.json> <horizon> [noiseRel] [phaseJitter]
// Reports per case: decoded cell bits over time (log-spaced + every trip for the first 400), accuracy vs targets extended to the
// horizon (the final target value of each cell is required to persist), settling time, margins, energy.
import { readFileSync } from 'node:fs'
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { createField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { mulberry32, gaussian } from '../../src/core/common/random'
import { slmRing } from './arch'
import { OUT, writeJson } from './util'

export interface Spec {
  tag: string; task: string; twin: string; arch: { roof: boolean; defocus: number; maxStep?: number }
  linear?: boolean; Glin?: number
  G0: number; Ig: number; s: number; Ia: number; kerr: number; I_init: number; I_hi: number; I_lo: number
  mask_file: string
  amp_file?: string; amp_dark?: number
  cells: Record<string, [number, number, number]>
  cases: { name: string; init_on: string[]; inject: { t: number; cell: string; amp: number; phase: number }[]; targets: { cell: string; value: number; t_from: number; t_to: number }[] }[]
}

export function buildSystem(spec: Spec, opts: { noiseRel?: number; seed?: number; maskOverride?: Float64Array; G0?: number } = {}) {
  const store = new AssetStore()
  const mask = opts.maskOverride ?? new Float64Array(readFileSync(spec.mask_file).buffer.slice(0))
  const ref = store.put(`mask_${spec.tag}`, 64, 64, mask)
  const cfg = slmRing({
    n: 64, spp: 1, roof: spec.arch.roof, inputFirst: true, defocus: spec.arch.defocus, maxStep: spec.arch.maxStep,
    ...(spec.linear
      ? { gain: { G0: spec.Glin!, sat: { kind: 'none' as const } } }
      : {
          gain: { G0: opts.G0 ?? spec.G0, sat: { kind: 'local' as const, saturationIntensity: spec.Ig }, noise: opts.noiseRel ? { kind: 'additive-gaussian' as const, meanIntensity: opts.noiseRel, seed: opts.seed ?? 1 } : undefined },
          nl: { amplitude: { kind: 'saturable' as const, strength: spec.s, saturationIntensity: spec.Ia }, phase: spec.kerr ? { kind: 'kerr' as const, coefficient: spec.kerr } : { kind: 'none' as const } },
        }),
    mask: { kind: 'array', ref },
    ampMask: spec.amp_file ? { dark: spec.amp_dark ?? 0, program: { kind: 'array', ref: store.put(`amp_${spec.tag}`, 64, 64, new Float64Array(readFileSync(spec.amp_file).buffer.slice(0))) } } : undefined,
  })
  return new CompiledSystem(cfg, store)
}

const idxOf = (c: [number, number, number]) => { const out: number[] = []; for (let j = 0; j < c[2]; j++) for (let i = 0; i < c[2]; i++) out.push((c[1] + j) * 64 + c[0] + i); return out }

export function runCase(spec: Spec, sys: CompiledSystem, ci: number, horizon: number, record: (t: number) => boolean, extraInject?: { t: number; cell: string; amp: number; phase: number }[]) {
  const c = spec.cases[ci]
  const names = Object.keys(spec.cells)
  const idx = Object.fromEntries(names.map((k) => [k, idxOf(spec.cells[k])]))
  const f = createField(sys.grid)
  for (const nm of c.init_on) for (const i of idx[nm]) f.re[i] = Math.sqrt(spec.I_init)
  const injs = [...c.inject, ...(extraInject ?? [])]
  const byT = new Map<number, Field>()
  for (const j of injs) {
    let fld = byT.get(j.t)
    if (!fld) byT.set(j.t, (fld = createField(sys.grid)))
    for (const i of idx[j.cell]) { fld.re[i] += j.amp * Math.cos(j.phase); fld.im[i] += j.amp * Math.sin(j.phase) }
  }
  let now = 0
  const ctx: RunContext = { cycle: 0, inputs: { take: (p) => (p === 'in' ? byT.get(now) ?? null : null) }, taps: { record: () => {} } }
  const trace: { t: number; I: number[]; bg: number; energy: number }[] = []
  const cellI = () => names.map((k) => idx[k].reduce((s, i) => s + f.re[i] ** 2 + f.im[i] ** 2, 0) / idx[k].length)
  const mask = new Uint8Array(f.re.length)
  for (const k of names) for (const i of idx[k]) mask[i] = 1
  const snap = (t: number) => {
    let bg = 0, e = 0
    for (let i = 0; i < f.re.length; i++) { const I = f.re[i] ** 2 + f.im[i] ** 2; e += I; if (!mask[i] && I > bg) bg = I }
    trace.push({ t, I: cellI(), bg, energy: e })
  }
  snap(0)
  const pow = () => { let e = 0; for (let i = 0; i < f.re.length; i++) e += f.re[i] ** 2 + f.im[i] ** 2; return e }
  let P0 = pow()
  for (let t = 1; t <= horizon; t++) {
    now = t
    sys.roundTrip(f, ctx)
    if (spec.linear) {
      // global gain clamp (exact for linear optics): hold total power at its post-injection level
      const p = pow()
      if (byT.has(t)) P0 = Math.max(P0, p)
      if (p > 1e-30) { const k = Math.sqrt(P0 / p); for (let i = 0; i < f.re.length; i++) { f.re[i] *= k; f.im[i] *= k } }
    }
    if (record(t)) snap(t)
  }
  return { trace, field: f }
}

export function scoreCase(spec: Spec, ci: number, trace: { t: number; I: number[] }[], horizon: number) {
  const c = spec.cases[ci]
  const names = Object.keys(spec.cells)
  const thr = 0.5 * (spec.I_hi + spec.I_lo)
  // targets extended: after the last target window of each cell, its final value must persist to the horizon
  const last: Record<string, { value: number; t_to: number }> = {}
  for (const tg of c.targets) if (!last[tg.cell] || tg.t_to > last[tg.cell].t_to) last[tg.cell] = { value: tg.value, t_to: tg.t_to }
  let ok = 0, tot = 0, firstFail: number | null = null, firstFailExt: number | null = null
  let minMargin = Infinity
  for (const s of trace) {
    for (const tg of c.targets) {
      if (s.t < tg.t_from || s.t > tg.t_to) continue
      const k = names.indexOf(tg.cell)
      const good = (s.I[k] > thr ? 1 : 0) === tg.value
      tot++; if (good) ok++; else if (firstFail === null) firstFail = s.t
      minMargin = Math.min(minMargin, tg.value ? s.I[k] / thr : thr / Math.max(s.I[k], 1e-12))
    }
    for (const [cell, v] of Object.entries(last)) {
      if (s.t <= v.t_to) continue
      const k = names.indexOf(cell)
      if ((s.I[k] > thr ? 1 : 0) !== v.value && firstFailExt === null) firstFailExt = s.t
    }
  }
  return { case: c.name, acc_train_window: tot ? ok / tot : NaN, first_fail_train_window: firstFail, first_fail_extended: firstFailExt, survived_to: firstFailExt ?? horizon, min_margin_ratio: minMargin }
}

if (process.argv[2]) {
  const [specPath, horizonS, noiseS, jitterS] = process.argv.slice(2)
  const spec: Spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const horizon = Number(horizonS ?? 10000)
  const noiseRel = Number(noiseS ?? 0)
  let maskOverride: Float64Array | undefined
  if (Number(jitterS ?? 0) > 0) {
    const m = new Float64Array(readFileSync(spec.mask_file).buffer.slice(0))
    const r = mulberry32(77)
    maskOverride = m.map((v) => v + Number(jitterS) * gaussian(r))
  }
  const rec = (t: number) => t <= 400 || t % Math.max(1, Math.floor(horizon / 400)) === 0 || t === horizon
  const results = []
  const t0 = performance.now()
  for (let ci = 0; ci < spec.cases.length; ci++) {
    const sys = buildSystem(spec, { noiseRel, seed: 11 + ci, maskOverride })
    const { trace } = runCase(spec, sys, ci, horizon, rec)
    const sc = scoreCase(spec, ci, trace, horizon)
    results.push({ ...sc, trace })
    console.log(`${spec.tag} ${sc.case}: acc(train window) ${sc.acc_train_window.toFixed(3)} firstFail ${sc.first_fail_train_window} extended-survival ${sc.survived_to}/${horizon} margin ${sc.min_margin_ratio.toFixed(2)}`)
  }
  const suffix = `${horizon}${noiseRel ? `_n${noiseRel}` : ''}${Number(jitterS ?? 0) ? `_j${jitterS}` : ''}`
  writeJson(`${OUT}08/eval_${spec.tag}_${suffix}.json`, { tag: spec.tag, horizon, noiseRel, jitter: Number(jitterS ?? 0), names: Object.keys(spec.cells), G0: spec.G0, results, seconds: (performance.now() - t0) / 1000 })
}
