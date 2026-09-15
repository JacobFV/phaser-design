// Experiment 1: single-dot echo stability.
// usage: npx vite-node 01-dot.ts <condition> <maxCycles> <sigma_um,...>
// Linear conditions are renormalised to unit power every trip (exact for a linear operator; identical to a global
// gain clamp); the passive energy is accumulated as Σ ln(P_t/P_{t-1}).
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { cloneField, createField, sampleX, sampleY, scaleField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem, type PhysicsConfig } from '../../src/core/physics/system'
import { lcdMla, linear4f, slmRing } from './arch'
import { OUT, addGaussian, compare, discFraction, fwhm, logCheckpoints, moments, total, writeCsv, writeF64 } from './util'

const assets = new AssetStore()

/** SLM defocus program: commanded phase −π r²/(λ f) per pixel (wrapped by the device), 64×64 px at 20 µm. */
export function slmLensProgram(fSlm: number, lambda = 650e-9) {
  const res = 64, pitch = 20e-6
  const data = new Float64Array(res * res)
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const px = (x - res / 2 + 0.5) * pitch, py = (y - res / 2 + 0.5) * pitch
    const ph = isFinite(fSlm) ? (-Math.PI * (px * px + py * py)) / (lambda * fSlm) : 0
    data[y * res + x] = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  }
  return { kind: 'array' as const, ref: assets.put(`slmlens_${fSlm}`, res, res, data) }
}

const BIST = { gain: { G0: Number(process.env.G0 ?? 2.2), sat: { kind: 'local' as const, saturationIntensity: 1 } }, nl: { amplitude: { kind: 'saturable' as const, strength: Number(process.env.S ?? -0.6), saturationIntensity: 0.05 }, phase: { kind: 'none' as const } } }

export const CONDITIONS: Record<string, { cfg: () => PhysicsConfig; linear: boolean; amp?: number; center?: [number, number]; pixel: number }> = {
  preset: { cfg: () => slmRing({ n: 128, focal: 40e-3, mask: { kind: 'random', seed: 3, depth: 0.1 } }), linear: true, pixel: 20e-6 },
  img: { cfg: () => slmRing({ n: 128, roof: true }), linear: true, pixel: 20e-6 },
  img_full: { cfg: () => slmRing({ n: 128, roof: true, compact: false }), linear: true, pixel: 20e-6 },
  img_spp4: { cfg: () => slmRing({ n: 256, spp: 4, roof: true }), linear: true, pixel: 20e-6 },
  img_rand: { cfg: () => slmRing({ n: 128, roof: true, mask: { kind: 'random', seed: 3, depth: 0.1 } }), linear: true, pixel: 20e-6 },
  img_ferr1e3: { cfg: () => slmRing({ n: 128, roof: true, focalErrorR: 1e-3 }), linear: true, pixel: 20e-6 },
  img_ferr1e2: { cfg: () => slmRing({ n: 128, roof: true, focalErrorR: 1e-2 }), linear: true, pixel: 20e-6 },
  // static SLM lens compensating the 1 % lensR error (focal found by 01b-maskopt.ts; set via env FSLM)
  img_ferr1e2_comp: { cfg: () => slmRing({ n: 128, roof: true, focalErrorR: 1e-2, mask: slmLensProgram(Number(process.env.FSLM)) }), linear: true, pixel: 20e-6 },
  bistable: { cfg: () => slmRing({ n: 128, roof: true, ...BIST }), linear: false, amp: Math.sqrt(1.5), pixel: 20e-6 },
  B_4f: { cfg: () => linear4f({ n: 128 }), linear: true, pixel: 63.5e-6 },
  // C: dot centred on a lenslet (lenslet centres at multiples of 254 µm)
  C_mla: { cfg: () => lcdMla({ n: 128 }), linear: true, center: [254e-6, 254e-6], pixel: 63.5e-6 },
}

function run(condKey: string, maxCycles: number, sigma: number) {
  const cond = CONDITIONS[condKey]
  const condName = condKey + (process.env.TAG ?? '')
  const cfg = cond.cfg()
  const sys = new CompiledSystem(cfg, assets)
  const g = sys.grid
  const [cx, cy] = cond.center ?? [60e-6, 40e-6] // away from the axis and boundaries
  const f = createField(g)
  addGaussian(f, sigma, cx, cy, cond.amp ?? 1)
  const f0 = cloneField(f)
  const m0 = moments(f)
  const fw0 = fwhm(f).areaFwhm
  const P0 = total(f)
  const Rcell = Math.max(3 * sigma, 2 * cond.pixel)
  const checkpoints = new Set(logCheckpoints(maxCycles))
  const snapAt = new Set([0, 10, 100, 1000, 10000, 100000, 1000000].filter((c) => c <= maxCycles))
  const rows: Record<string, number | string>[] = []
  let logE = 0
  let prev: Field | null = null
  let halfState: Field = cloneField(f)
  const tRt = sys.timing().roundTripTime
  const record = (c: number, gainLast: number) => {
    const m = moments(f), cmp = compare(f0, f), mLocal = moments(f, cx, cy, Rcell), fw = fwhm(f)
    const conv = prev ? compare(halfState, f).corr : 1
    rows.push({
      condition: condName, sigma0_um: sigma * 1e6, sigma0_samples: sigma / g.dx, sigma0_pixels: sigma / cond.pixel, cycle: c, time_s: c * tRt,
      corr: cmp.corr, fidelity: cmp.fidelity, phaseCoherence: cmp.phaseCoherence,
      sigma_um: m.sigma * 1e6, sigmaLocal_um: mLocal.sigma * 1e6, fwhm_um: fw.areaFwhm * 1e6, width_ratio: m.sigma / m0.sigma, fwhm_ratio: fw.areaFwhm / fw0,
      drift_um: Math.hypot(m.cx - m0.cx, m.cy - m0.cy) * 1e6, driftLocal_um: Math.hypot(mLocal.cx - cx, mLocal.cy - cy) * 1e6,
      logEnergy: cond.linear ? logE : Math.log(total(f) / P0), peak_rel: cond.linear ? (m.peak / m.power) / (m0.peak / m0.power) : m.peak / m0.peak,
      leakage: 1 - discFraction(f, cx, cy, Rcell), gain_last: gainLast, corr_vs_half: conv,
    })
  }
  record(0, 1)
  for (let c = 1; c <= maxCycles; c++) {
    const before = total(f)
    sys.roundTrip(f, NULL_CONTEXT)
    const after = total(f)
    if (cond.linear) {
      if (after <= 0) break
      logE += Math.log(after / before)
      scaleField(f, Math.sqrt(P0 / after))
    }
    if (checkpoints.has(c)) {
      prev = f
      record(c, after / before)
      // "converged to another eigenmode": compare with the state at the previous checkpoint ≈ c/1.33
      halfState = cloneField(f)
    }
    if (snapAt.has(c)) {
      const I = new Float64Array(g.nx * g.ny)
      for (let i = 0; i < I.length; i++) I[i] = f.re[i] ** 2 + f.im[i] ** 2
      writeF64(`${OUT}01/snap_${condName}_s${(sigma * 1e6).toFixed(0)}_c${c}.f64`, I)
    }
    if (!cond.linear && after === 0) break
  }
  writeCsv(`${OUT}01/dot_${condName}_s${(sigma * 1e6).toFixed(0)}.csv`, rows)
  const last = rows[rows.length - 1]
  console.log(`${condName} σ=${(sigma * 1e6).toFixed(0)}µm (${(sigma / g.dx).toFixed(2)} samples, ${(sigma / cond.pixel).toFixed(2)} px) → @${last.cycle}: corr ${(+last.corr).toFixed(4)} fid ${(+last.fidelity).toFixed(4)} width× ${(+last.width_ratio).toFixed(3)} leak ${(+last.leakage).toFixed(4)} logE/cycle ${(+last.logEnergy / +last.cycle).toExponential(3)}`)
}

if (process.argv[2] && process.argv[2] in CONDITIONS) {
  const [cond, max, sig] = process.argv.slice(2)
  for (const s of sig.split(',')) run(cond, Number(max), Number(s) * 1e-6)
}
