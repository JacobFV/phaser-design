// Experiment 10: autonomous clock / state progression from static optics alone (no JS clock, no mask updates).
// A re-entrant resonator (round-trip ABCD M with M^q = I) cycles any launched state through q distinct field states.
//  q = 2: self-imaging ring without the roof (M = −I): a dot toggles between x and −x every trip.
//  q/p: preset relay (f = 40 mm) + one static SLM lens chosen so that trace(M) = 2 cos(2πp/q)  (M^q = I paraxially; the state
//  advances p of q phase-space steps per trip). Preset relay alone: trace −1.75 (≈151°/trip). q = 4, 8 need 87 / 158 D lenses
//  (beyond the ~25 D pixel-sampling limit of a 20 µm SLM); 2/5, 3/7, 5/12 need 6.6, −2.6, 0.9 D.
// usage: npx vite-node 10-clock.ts <q[/p]> <horizon> <noiseRel> [nl]
// Decoding: the state at trip t is the reference field (trips q…2q−1) with the largest normalised overlap; contrast = best/second.
// Linear optics with a global gain clamp (renormalised each trip); optional additive complex noise per trip.
// usage: npx vite-node 10-clock.ts <q> <horizon> <noiseRel> [nonlinear]
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { createField, sampleX, sampleY, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem } from '../../src/core/physics/system'
import { gaussian, mulberry32 } from '../../src/core/common/random'
import { slmRing } from './arch'
import { OUT, addGaussian, writeCsv, writeJson } from './util'

type M2 = [number, number, number, number]
const mul = (a: M2, b: M2): M2 => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]
const prop = (L: number): M2 => [1, L, 0, 1]
const lens = (f: number): M2 => [1, 0, -1 / f, 1]

/** SLM lens power P (1/m) making trace(M_rt) = target for the compact preset route SLM→40→L→100→L→60. */
export function slmPowerForTrace(f: number, target: number) {
  const A = mul(prop(60e-3), mul(lens(f), mul(prop(100e-3), mul(lens(f), prop(40e-3)))))
  // M = A · [[1,0],[−P,1]]  ⇒  tr M = A00 + A11 − P·A01
  return { P: (A[0] + A[3] - target) / A[1], trA: A[0] + A[3] }
}

/** static SLM program realising a thin lens of power P through the device's wrap/γ/λ response (256 levels) */
export function slmLens(store: AssetStore, P: number, lambda = 650e-9) {
  const res = 64, pitch = 20e-6, range = 2 * Math.PI * (633e-9 / lambda), gamma = 1.05
  const data = new Float64Array(res * res)
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const px = (x - res / 2 + 0.5) * pitch, py = (y - res / 2 + 0.5) * pitch
    let phi = (-Math.PI * P * (px * px + py * py)) / lambda
    phi = ((phi % range) + range) % range // wrap at the achievable stroke
    const u = Math.pow(phi / range, 1 / gamma)
    data[y * res + x] = Math.min(u, 0.9999) * 2 * Math.PI
  }
  return { kind: 'array' as const, ref: store.put(`lens_${P}`, res, res, data) }
}

function run(q: number, pRot: number, horizon: number, noiseRel: number, nonlinear: boolean) {
  const store = new AssetStore()
  let cfg, info: Record<string, number | string> = { q, p: pRot }
  const act = nonlinear ? { gain: { G0: 1.6, sat: { kind: 'local' as const, saturationIntensity: 1 } }, nl: { amplitude: { kind: 'saturable' as const, strength: -0.2, saturationIntensity: 0.05 }, phase: { kind: 'none' as const } } } : {}
  if (q === 2) {
    cfg = slmRing({ n: 64, spp: 1, roof: false, ...act })
    info = { ...info, hardware: 'A_img without roof (M = −I)', slmPower_D: 0 }
  } else {
    const { P, trA } = slmPowerForTrace(40e-3, 2 * Math.cos((2 * Math.PI * pRot) / q))
    if (Math.abs(P) > 25) throw new Error(`SLM lens ${P.toFixed(1)} D exceeds the ~25 D pixel-sampling limit`)
    cfg = slmRing({ n: 64, spp: 1, focal: 40e-3, maxStep: 10e-3, mask: slmLens(store, P), ...act })
    info = { ...info, hardware: 'A_preset optics + static SLM lens', slmPower_D: P, trace_without_slm: trA }
  }
  const sys = new CompiledSystem(cfg, store)
  const g = sys.grid
  const f = createField(g)
  addGaussian(f, 40e-6, 160e-6, 100e-6) // 2 px dot off axis
  const ctx: RunContext = { cycle: 0, inputs: { take: () => null }, taps: { record: () => {} } }
  const r = mulberry32(5)
  const norm = (h: Field) => { let s = 0; for (let i = 0; i < h.re.length; i++) s += h.re[i] ** 2 + h.im[i] ** 2; return s }
  const refs: Field[] = []
  const rows: Record<string, number | string>[] = []
  const nearX = (h: Field, cx: number, cy: number) => {
    let s = 0, tot = 0
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const I = h.re[j * g.nx + i] ** 2 + h.im[j * g.nx + i] ** 2
      tot += I
      if ((sampleX(g, i) - cx) ** 2 + (sampleY(g, j) - cy) ** 2 < (60e-6) ** 2) s += I
    }
    return s / tot
  }
  const decodeTimes = new Set<number>()
  for (let t = q; t < 2 * q; t++) decodeTimes.add(t)
  for (let e = 1; 10 ** e <= horizon; e += 0.25) { const c = Math.round(10 ** e); for (let k = 0; k < q; k++) decodeTimes.add(c + k) }
  for (let t = 1; t <= 64 * q && t <= horizon; t++) decodeTimes.add(t)
  let firstError: number | null = null
  let P0 = norm(f)
  for (let t = 1; t <= horizon; t++) {
    sys.roundTrip(f, ctx)
    if (noiseRel > 0) {
      const s = Math.sqrt((noiseRel * P0) / (2 * f.re.length))
      for (let i = 0; i < f.re.length; i++) { f.re[i] += s * gaussian(r); f.im[i] += s * gaussian(r) }
    }
    if (!nonlinear) { const k = Math.sqrt(P0 / norm(f)); for (let i = 0; i < f.re.length; i++) { f.re[i] *= k; f.im[i] *= k } }
    if (t >= q && t < 2 * q) refs.push({ grid: g, re: f.re.slice(), im: f.im.slice() })
    if (!decodeTimes.has(t) || refs.length < q) continue
    const nf = norm(f)
    const ov = refs.map((h) => { let re = 0, im = 0; for (let i = 0; i < f.re.length; i++) { re += h.re[i] * f.re[i] + h.im[i] * f.im[i]; im += h.re[i] * f.im[i] - h.im[i] * f.re[i] } return (re * re + im * im) / (norm(h) * nf) })
    const order = ov.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0])
    const decoded = (order[0][1] + q) % q // reference index k corresponds to trip q + k ≡ k (mod q)
    const expected = t % q
    const ok = decoded === expected
    if (!ok && firstError === null) firstError = t
    rows.push({ q, t, time_s: t * sys.timing().roundTripTime, decoded, expected, ok: ok ? 1 : 0, best_overlap: order[0][0], second_overlap: order[1][0], contrast: order[0][0] / Math.max(order[1][0], 1e-12),
      near_plus: nearX(f, 160e-6, 100e-6), near_minus: nearX(f, -160e-6, -100e-6), energy: nf })
  }
  const tag = `q${q}p${pRot}_n${noiseRel}${nonlinear ? '_nl' : ''}`
  writeCsv(`${OUT}10/clock_${tag}.csv`, rows)
  const tail = rows.filter((x) => +x.t > horizon / 2)
  const summary = { ...info, horizon, noiseRel, nonlinear, t_rt: sys.timing().roundTripTime, trips_per_tick: 1, ticks_per_cycle: q, clock_frequency_Hz: 1 / sys.timing().roundTripTime,
    first_sequence_error: firstError, decoded_fraction_ok: rows.reduce((a, x) => a + +x.ok, 0) / rows.length,
    min_contrast: Math.min(...rows.map((x) => +x.contrast)), late_mean_best_overlap: tail.reduce((a, x) => a + +x.best_overlap, 0) / Math.max(1, tail.length) }
  writeJson(`${OUT}10/clock_${tag}.json`, summary)
  console.log(JSON.stringify(summary))
}

if (process.argv[2]) {
  const [qp, h, n, nl] = process.argv.slice(2)
  const [q, pr] = qp.split('/').map(Number)
  run(q, pr ?? 1, Number(h), Number(n ?? 0), nl === 'nl')
}
