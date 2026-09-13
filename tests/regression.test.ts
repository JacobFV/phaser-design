// The original chamber, expressed as a linear-reciprocal topology on the generic engine, must reproduce the frozen
// legacy engine field-for-field. Mask programs are handed over as external arrays so both use identical phases.
import { describe, expect, it } from 'vitest'
import { AssetStore } from '../src/core/physics/assets'
import type { RunContext } from '../src/core/physics/elements/element'
import type { OpticalElementSpec } from '../src/core/physics/elements/types'
import { createField, meanIntensity, type Field } from '../src/core/physics/field/grid'
import { CompiledSystem, type PhysicsConfig } from '../src/core/physics/system'
import { Cavity, buildMasks } from './fixtures/legacy/cavity'
import { inputField2 } from './fixtures/legacy/field2d'
import { DEFAULT_PARAMS, LCD_PIXELS, N } from './fixtures/legacy/params'
import { legacyRing } from './helpers'

const p = { ...DEFAULT_PARAMS }
const pitch = p.pitchUm * 1e-6
const d = p.dSepMm * 1e-3

function newEngine() {
  const assets = new AssetStore()
  const { masks, mOut } = buildMasks(p)
  const lcd = (id: string, mask: Float64Array, clear: number): OpticalElementSpec => ({
    kind: 'transmissive-lcd', id,
    pixels: { resolution: { x: LCD_PIXELS, y: LCD_PIXELS }, pitch: { x: pitch, y: pitch }, fillFactor: 1, offset: { x: 0, y: 0 } },
    modulation: { kind: 'phase', phaseRange: 2 * Math.PI, levels: 0, response: { kind: 'linear' } },
    clearTransmission: clear,
    surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
    polarizerTransmission: 1, deadZoneTransmission: 0, switchingTime: 0.01, designWavelength: p.lambdaNm * 1e-9,
    program: { kind: 'array', ref: assets.put(id, LCD_PIXELS, LCD_PIXELS, mask) },
  })
  const air = { kind: 'custom', refractiveIndex: 1, attenuationPerM: -Math.log(0.998) } as const // legacy kernel used n = 1
  const config: PhysicsConfig = {
    field: { grid: { nx: N, ny: N, dx: pitch / 2, dy: pitch / 2 }, wavelength: p.lambdaNm * 1e-9, boundary: { kind: 'periodic' } },
    elements: [
      { kind: 'coupler', id: 'in', retained: { front: p.rIn, back: p.rIn }, inputPort: 'x' },
      ...masks.map((m, i) => lcd(`lcd${i}`, m, p.tLcd)),
      { kind: 'coupler', id: 'out', retained: { front: p.rOut, back: p.rOut }, outputTap: 'readout' },
      { kind: 'gain', id: 'gain', smallSignalGain: p.gain, saturation: { kind: 'global', saturationIntensity: 0.5 }, noise: { kind: 'none' } },
    ],
    topology: {
      kind: 'linear-reciprocal', length: (p.nLcd + 1) * d, medium: air,
      start: { elementIds: ['in'] }, end: { elementIds: ['out', 'gain'] },
      items: masks.map((_, i) => ({ elementId: `lcd${i}`, position: (i + 1) * d })),
    },
    readouts: [{ id: 'ccd', tap: 'readout', stages: [{ kind: 'element', element: lcd('mout', mOut, 1), side: 'front' }], detector: { kind: 'fourier-plane', focalLength: 0.05 } }],
  }
  return new CompiledSystem(config, assets)
}

describe('regression: legacy chamber on the generic engine', () => {
  it('reproduces fields, readout and energy trip by trip', () => {
    const amp = legacyRing()
    const legacy = new Cavity(p, amp)
    const sys = newEngine()

    const x = inputField2(amp)
    const input: Field = createField(sys.grid)
    input.re.set(x.re)
    input.im.set(x.im)

    const field = createField(sys.grid)
    const taps = new Map<string, Field>()
    for (let t = 0; t < 4; t++) {
      const ctx: RunContext = {
        cycle: t,
        inputs: { take: () => (t === 0 ? input : null) },
        taps: {
          record: (id, f, a) => {
            const c = createField(f.grid)
            for (let i = 0; i < c.re.length; i++) { c.re[i] = f.re[i] * a; c.im[i] = f.im[i] * a }
            taps.set(id, c)
          },
        },
      }
      sys.roundTrip(field, ctx)
      const rec = legacy.step(null)

      let maxDiff = 0
      for (let i = 0; i < field.re.length; i++)
        maxDiff = Math.max(maxDiff, Math.abs(field.re[i] - rec.images.ret[2 * i]), Math.abs(field.im[i] - rec.images.ret[2 * i + 1]))
      expect(maxDiff).toBeLessThan(1e-5) // legacy images are float32
      expect(meanIntensity(field) / rec.energy).toBeCloseTo(1, 9)

      const tap = taps.get('readout')!
      let tapDiff = 0
      for (let i = 0; i < tap.re.length; i++) tapDiff = Math.max(tapDiff, Math.abs(tap.re[i] - rec.images.readout[2 * i]))
      expect(tapDiff).toBeLessThan(1e-5)

      // detector: same pattern up to the physical normalisation of the Fourier plane
      const ccd = sys.readouts(taps)[0].intensity
      const sA = ccd.reduce((s, v) => s + v, 0)
      const sB = rec.ccd.reduce((s, v) => s + v, 0)
      let shapeDiff = 0
      for (let i = 0; i < ccd.length; i++) shapeDiff = Math.max(shapeDiff, Math.abs(ccd[i] / sA - rec.ccd[i] / sB))
      expect(shapeDiff).toBeLessThan(1e-6)
    }
  })
})
