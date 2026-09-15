// Experiment 5 (and long horizons for 1, 3, 4): dump explicit complex round-trip matrices of the linear operators.
// usage: npx vite-node 05-extract.ts <name>
import { AssetStore } from '../../src/core/physics/assets'
import { CompiledSystem } from '../../src/core/physics/system'
import type { PhysicsConfig } from '../../src/core/physics/system'
import { lcdMla, linear4f, slmRing } from './arch'
import { BIG, extractMatrix, writeF64, writeJson } from './util'

export const OPERATORS: Record<string, () => PhysicsConfig> = {
  // A: self-imaging ring (+I), zero mask — the best static optical program for localized states
  A_img: () => slmRing({ roof: true, spp: 1, n: 64 }),
  // A: preset-faithful relay (f = 40 mm, no roof) with the preset's random SLM program
  A_preset: () => slmRing({ focal: 40e-3, spp: 1, n: 64, mask: { kind: 'random', seed: 3, depth: 0.1 } }),
  // A: self-imaging ring with the preset random SLM program (static mask disorder)
  A_img_rand: () => slmRing({ roof: true, spp: 1, n: 64, mask: { kind: 'random', seed: 3, depth: 0.1 } }),
  // 10 mm propagation steps (no FFT wrap-around of mask-scattered light): validity re-check of the random-mask operators
  A_preset_s: () => slmRing({ focal: 40e-3, spp: 1, n: 64, maxStep: 10e-3, mask: { kind: 'random', seed: 3, depth: 0.1 } }),
  A_img_rand_s: () => slmRing({ roof: true, spp: 1, n: 64, maxStep: 10e-3, mask: { kind: 'random', seed: 3, depth: 0.1 } }),
  A_img_s: () => slmRing({ roof: true, spp: 1, n: 64, maxStep: 10e-3 }),
  // Experiment 19: wavelength with geometry fixed
  A_img_450: () => slmRing({ roof: true, spp: 1, n: 64, wavelength: 450e-9 }),
  A_img_532: () => slmRing({ roof: true, spp: 1, n: 64, wavelength: 532e-9 }),
  B_4f_450: () => linear4f({ n: 64, wavelength: 450e-9 }),
  B_4f_532: () => linear4f({ n: 64, wavelength: 532e-9 }),
  // B: linear reciprocal 4f cavity (forward −I, round trip +I)
  B_4f: () => linear4f({ n: 64 }),
  // B: lensless plane-parallel LCD cavity of the same length (like the shipped preset)
  B_flat: () => linear4f({ n: 64, lensless: true }),
  // C: LCD + MLA per-lenslet cat's-eye cavity
  C_mla: () => lcdMla({ n: 64 }),
}

const name = process.argv[2]
if (name) {
  const cfg = OPERATORS[name]()
  const sys = new CompiledSystem(cfg, new AssetStore())
  const t0 = performance.now()
  const M = extractMatrix(sys)
  writeF64(`${BIG}${name}.c128`, M)
  const t = sys.timing()
  writeJson(`${BIG}${name}.json`, { name, n: sys.grid.nx, dx: sys.grid.dx, wavelength: sys.wavelength, roundTripTime: t.roundTripTime, budget: sys.powerBudget(), warnings: sys.warnings(), config: cfg })
  console.log(`${name}: ${sys.grid.nx}² extracted in ${((performance.now() - t0) / 1000).toFixed(1)} s; t_rt ${(t.roundTripTime * 1e9).toFixed(3)} ns`)
}
