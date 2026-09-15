// Dump the exact per-step operations of a compiled route (arrays pulled out of the live JS objects) so a torch replica
// can differentiate through the same physics, plus a reference trajectory to validate the replica bit-for-bit.
// usage: npx vite-node twin-dump.ts <name>   (names below)
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT, type RunContext } from '../../src/core/physics/elements/element'
import { buildPixelMap } from '../../src/core/physics/elements/pixels'
import { createField, type Field } from '../../src/core/physics/field/grid'
import { CompiledSystem, type PhysicsConfig } from '../../src/core/physics/system'
import { mulberry32 } from '../../src/core/common/random'
import { lcdMla, linear4f, slmRing } from './arch'
import { BIG, addGaussian, writeF64, writeJson } from './util'

const BIST = { gain: { G0: 2.2, sat: { kind: 'local' as const, saturationIntensity: 1 } }, nl: { amplitude: { kind: 'saturable' as const, strength: -0.6, saturationIntensity: 0.05 }, phase: { kind: 'kerr' as const, coefficient: 0.1 } } }
export const TWINS: Record<string, () => PhysicsConfig> = {
  A64: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A128: () => slmRing({ n: 128, spp: 2, roof: true, inputFirst: true, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64noroof: () => slmRing({ n: 64, spp: 1, roof: false, inputFirst: true, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64d2: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, defocus: 2e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64d5: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, defocus: 5e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64d10: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, defocus: 10e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A128d5: () => slmRing({ n: 128, spp: 2, roof: true, inputFirst: true, defocus: 5e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64s: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64sd5: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3, defocus: 5e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64snoroof: () => slmRing({ n: 64, spp: 1, roof: false, inputFirst: true, maxStep: 10e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  A64s_amp: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 }, ampMask: { dark: 0, program: { kind: 'random', seed: 5, depth: 1 } } }),
  A64sd5_amp: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3, defocus: 5e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 }, ampMask: { dark: 0, program: { kind: 'random', seed: 5, depth: 1 } } }),
  A64s_amp3: () => slmRing({ n: 64, spp: 1, roof: true, inputFirst: true, maxStep: 10e-3, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 }, ampMask: { dark: 1e-3, program: { kind: 'random', seed: 5, depth: 1 } } }),
  B64: () => linear4f({ n: 64, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
  C64: () => lcdMla({ n: 64, ...BIST, mask: { kind: 'random', seed: 9, depth: 0.3 } }),
}

const c128 = (re: Float64Array, im: Float64Array) => { const a = new Float64Array(2 * re.length); for (let i = 0; i < re.length; i++) { a[2 * i] = re[i]; a[2 * i + 1] = im[i] } return a }

export function dump(name: string, cfg: PhysicsConfig) {
  const dir = `${BIG}twin_${name}/`
  const assets = new AssetStore()
  const sys = new CompiledSystem(cfg, assets)
  const g = sys.grid
  const N = g.nx * g.ny
  let fileNo = 0
  const save = (re: Float64Array, im: Float64Array) => { const fn = `a${fileNo++}.c128`; writeF64(dir + fn, c128(re, im)); return fn }
  const probe = (apply: (f: Field) => void) => { const f = createField(g); f.re.fill(1); apply(f); return save(f.re, f.im) }
  const ops: Record<string, unknown>[] = []
  const boundary: Float64Array | null = (sys as any).boundary
  const bfile = boundary ? save(boundary, new Float64Array(N)) : null
  const pixelOp = (spec: any, side: 'front' | 'back', kind: 'slm' | 'lcd') => {
    const px = spec.pixels
    const map = buildPixelMap(g, px)
    const mapFile = `map${fileNo++}.i32`
    writeF64(dir + mapFile, Float64Array.from(map))
    if (kind === 'slm') {
      return { op: 'pixelphase', device: spec.id, side, map: mapFile, resX: px.resolution.x, resY: px.resolution.y,
        amp: side === 'back' ? 0 : Math.sqrt(spec.reflectivity), deadAmp: side === 'back' ? 0 : Math.sqrt(spec.deadZoneReflectivity), outsideAmp: 0, scale: 1,
        phaseRange: spec.phaseRange, levels: spec.phaseLevels, response: spec.phaseResponse, lambdaScale: spec.designWavelength / sys.wavelength }
    }
    const m = spec.modulation
    if (m.kind === 'amplitude') {
      return { op: 'pixelamp', device: spec.id, side, map: mapFile, resX: px.resolution.x, resY: px.resolution.y,
        clear: spec.clearTransmission, dark: m.darkTransmission, levels: m.levels, deadAmp: Math.sqrt(spec.deadZoneTransmission), outsideAmp: 0,
        scale: Math.sqrt(spec.surfaces[side].transmission * spec.polarizerTransmission) }
    }
    return { op: 'pixelphase', device: spec.id, side, map: mapFile, resX: px.resolution.x, resY: px.resolution.y,
      amp: Math.sqrt(spec.clearTransmission), deadAmp: Math.sqrt(spec.deadZoneTransmission), outsideAmp: 0, scale: Math.sqrt(spec.surfaces[side].transmission * spec.polarizerTransmission),
      phaseRange: m.phaseRange, levels: m.levels, response: m.response, lambdaScale: spec.designWavelength / sys.wavelength }
  }
  for (const st of (sys as any).steps) {
    if (st.kind === 'propagate') { ops.push({ op: 'prop', kernel: save(st.kernel.re, st.kernel.im), boundary: bfile }); continue }
    const el = st.element, spec = el.spec, side = st.side as 'front' | 'back'
    switch (spec.kind) {
      case 'coupler':
        ops.push({ op: 'scale', a: Math.sqrt(spec.retained[side]) })
        if (spec.inputPort && side === 'front') ops.push({ op: 'inject', port: spec.inputPort, coupling: Math.sqrt(spec.inputCoupling ?? 1 - spec.retained.front) })
        break
      case 'mirror':
        ops.push({ op: 'scale', a: Math.sqrt(spec.reflectivity[side]) })
        if (spec.parity !== 'none') ops.push({ op: spec.parity })
        break
      case 'lcos-slm': ops.push(pixelOp(spec, side, 'slm')); break
      case 'transmissive-lcd': ops.push(pixelOp(spec, side, 'lcd')); break
      case 'lcd-microlens': {
        const lcd = pixelOp({ ...spec.lcd, id: spec.id }, side, 'lcd')
        const gap = { op: 'prop', kernel: save(el.gap.re, el.gap.im), boundary: null }
        const mla = { op: 'mul', t: probe((f) => el.mla.apply(f, side)) }
        ops.push(...(side === 'front' ? [lcd, gap, mla] : [mla, gap, lcd]))
        break
      }
      case 'gain': ops.push({ op: 'gain', G0: spec.smallSignalGain, saturation: spec.saturation, noise: spec.noise }); break
      case 'nonlinear': ops.push({ op: 'nonlinear', amplitude: spec.amplitude, phase: spec.phase }); break
      default: ops.push({ op: 'mul', t: probe((f) => el.apply(f, side, NULL_CONTEXT)) })
    }
  }
  // reference trajectory: smooth field + injected pulse on trip 2, 6 trips, nonlinear active, random mask
  const f = createField(g)
  addGaussian(f, 3 * g.dx, 4 * g.dx, 2 * g.dx, 1.1)
  addGaussian(f, 2 * g.dx, -9 * g.dx, 6 * g.dx, 0.6, 2)
  const r = mulberry32(3)
  for (let i = 0; i < N; i++) { f.re[i] += 0.05 * (r() - 0.5); f.im[i] += 0.05 * (r() - 0.5) }
  writeF64(dir + 'traj0.c128', c128(f.re, f.im))
  const inj = createField(g); addGaussian(inj, 2 * g.dx, 0, -8 * g.dx, 3)
  writeF64(dir + 'inject.c128', c128(inj.re, inj.im))
  for (let t = 1; t <= 6; t++) {
    const ctx: RunContext = { cycle: t, inputs: { take: (p) => (t === 2 && p === 'in' ? inj : null) }, taps: { record: () => {} } }
    sys.roundTrip(f, ctx)
    writeF64(dir + `traj${t}.c128`, c128(f.re, f.im))
  }
  const programmable = cfg.elements.filter((e: any) => e.program || e.lcd?.program).map((e: any) => ({ id: e.id, program: e.program ?? e.lcd.program }))
  writeJson(dir + 'twin.json', { name, grid: g, wavelength: sys.wavelength, roundTripTime: sys.timing().roundTripTime, ops, programmable, config: cfg })
  console.log(`${name}: ${ops.length} ops dumped to ${dir}`)
}

if (process.argv[2]) for (const n of process.argv.slice(2)) dump(n, TWINS[n]())
