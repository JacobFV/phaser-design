// Experiment 15: reservoir computing baseline. Fixed masks, scalar input injected through a static random spatial pattern
// every K round trips; detector features (binned |E|² of the out-coupled tap, 16×16) recorded once per input step.
// usage: npx vite-node 15-reservoir.ts <opName> <K> [steps]
import { AssetStore } from '../../src/core/physics/assets'
import type { RunContext } from '../../src/core/physics/elements/element'
import { createField, sampleX, sampleY, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem, type PhysicsConfig } from '../../src/core/physics/system'
import { mulberry32, gaussian } from '../../src/core/common/random'
import { slmRing, linear4f, lcdMla } from './arch'
import { OUT, writeF64, writeJson } from './util'

type Op = { cfg: () => PhysicsConfig; inputAmp: number; note: string }
const sat = (G0: number, s: number, kerr = 0) => ({
  gain: { G0, sat: { kind: 'local' as const, saturationIntensity: 1 } },
  nl: { amplitude: { kind: 'saturable' as const, strength: s, saturationIntensity: 0.05 }, phase: kerr ? { kind: 'kerr' as const, coefficient: kerr } : { kind: 'none' as const } },
})
const glob = (G0: number) => ({ gain: { G0, sat: { kind: 'global' as const, saturationIntensity: 0.05 } } })
const RAND = { kind: 'random' as const, seed: 3, depth: 0.1 }
export const OPS: Record<string, Op> = {
  // "messy" preset relay with the preset random SLM program, different active media
  Apre_lin: { cfg: () => slmRing({ n: 64, spp: 1, focal: 40e-3, inputFirst: true, mask: RAND, ...glob(1.6) }), inputAmp: 6, note: 'global saturable gain (linear optics, intensity detection)' },
  Apre_sat: { cfg: () => slmRing({ n: 64, spp: 1, focal: 40e-3, inputFirst: true, mask: RAND, ...sat(1.6, -0.2) }), inputAmp: 6, note: 'local gain + weak absorber, below lasing' },
  Apre_sat2: { cfg: () => slmRing({ n: 64, spp: 1, focal: 40e-3, inputFirst: true, mask: RAND, ...sat(2.0, -0.4) }), inputAmp: 6, note: 'local gain + absorber, near threshold' },
  Apre_kerr: { cfg: () => slmRing({ n: 64, spp: 1, focal: 40e-3, inputFirst: true, mask: RAND, ...sat(1.6, -0.2, 1.0) }), inputAmp: 6, note: 'as Apre_sat plus Kerr κ=1' },
  // self-imaging ring (long linear memory) with the same media
  Aimg_lin: { cfg: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, mask: RAND, ...glob(1.6) }), inputAmp: 6, note: 'self-imaging + preset random mask, global gain' },
  Aimg_sat: { cfg: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, mask: RAND, ...sat(1.6, -0.2) }), inputAmp: 6, note: 'self-imaging + random mask, local gain + weak absorber' },
  B_sat: { cfg: () => linear4f({ n: 64, mask: RAND, ...sat(1.8, -0.2) }), inputAmp: 6, note: 'linear 4f LCD cavity' },
  C_sat: { cfg: () => lcdMla({ n: 64, mask: RAND, ...sat(2.2, -0.2) }), inputAmp: 6, note: 'LCD+MLA cavity' },
}

export function inputPattern(g: { nx: number; ny: number; dx: number; dy: number }, seed: number, corr = 3) {
  // smooth complex random pattern (sum of Gaussians) covering the central 60 % of the window
  const r = mulberry32(seed)
  const f = createField(g as any)
  const L = g.nx * g.dx * 0.3
  for (let k = 0; k < 40; k++) {
    const cx = (r() * 2 - 1) * L, cy = (r() * 2 - 1) * L, a = gaussian(r), b = gaussian(r)
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const e = Math.exp(-((sampleX(g as any, i) - cx) ** 2 + (sampleY(g as any, j) - cy) ** 2) / (2 * (corr * g.dx) ** 2))
      f.re[j * g.nx + i] += a * e; f.im[j * g.nx + i] += b * e
    }
  }
  let m = 0
  for (let i = 0; i < f.re.length; i++) m = Math.max(m, Math.hypot(f.re[i], f.im[i]))
  for (let i = 0; i < f.re.length; i++) { f.re[i] /= m; f.im[i] /= m }
  return f
}

export function run(opName: string, K: number, steps: number, inputs: Float64Array, tag: string) {
  const op = OPS[opName]
  const sys = new CompiledSystem(op.cfg(), new AssetStore())
  const g = sys.grid
  const P = inputPattern(g, 101)
  const f = createField(g)
  const inj = createField(g)
  const bin = g.nx / 16
  const feats = new Float64Array(steps * 256)
  let pending = false
  const ctx: RunContext = { cycle: 0, inputs: { take: (p) => (p === 'in' && pending ? (pending = false, inj) : null) }, taps: { record: () => {} } }
  const t0 = performance.now()
  let maxI = 0
  for (let s = 0; s < steps; s++) {
    const u = inputs[s]
    for (let i = 0; i < f.re.length; i++) { inj.re[i] = op.inputAmp * u * P.re[i]; inj.im[i] = op.inputAmp * u * P.im[i] }
    pending = true
    for (let k = 0; k < K; k++) sys.roundTrip(f, ctx)
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const I = f.re[j * g.nx + i] ** 2 + f.im[j * g.nx + i] ** 2
      feats[s * 256 + Math.floor(j / bin) * 16 + Math.floor(i / bin)] += I
      if (I > maxI) maxI = I
    }
  }
  writeF64(`${OUT}15/feat_${opName}_K${K}_${tag}.f64`, feats)
  const secs = (performance.now() - t0) / 1000
  writeJson(`${OUT}15/feat_${opName}_K${K}_${tag}.json`, { opName, K, steps, tag, note: op.note, t_rt: sys.timing().roundTripTime, secs, maxI })
  console.log(`${opName} K=${K} ${tag}: ${steps} steps in ${secs.toFixed(0)} s, max |E|² ${maxI.toFixed(3)}`)
}

if (process.argv[2]) {
  const [opName, Ks, stepsS] = process.argv.slice(2)
  const steps = Number(stepsS ?? 3200)
  const r = mulberry32(2024)
  const uni = new Float64Array(steps), bits = new Float64Array(steps)
  for (let s = 0; s < steps; s++) { uni[s] = 0.5 * r(); bits[s] = r() < 0.5 ? 0 : 1 }
  writeF64(`${OUT}15/inputs_uniform.f64`, uni)
  writeF64(`${OUT}15/inputs_bits.f64`, bits)
  run(opName, Number(Ks), steps, uni, 'uniform')
  run(opName, Number(Ks), steps, bits.map((b) => 0.5 * b), 'bits')
}
