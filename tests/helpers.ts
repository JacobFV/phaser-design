// Shared fixtures. Kept out of *.test.ts files so importing them never re-runs another suite.
import type { TransmissiveLcdSpec } from '../src/core/physics/elements/types'
import { LCD_PIXELS } from './fixtures/legacy/params'

/** 64×64 ring used as the legacy input pattern. */
export function legacyRing(): Float32Array {
  const L = LCD_PIXELS
  const amp = new Float32Array(L * L)
  for (let y = 0; y < L; y++)
    for (let x = 0; x < L; x++) amp[y * L + x] = Math.abs(Math.hypot(x - 32, y - 32) - 20) < 2.5 ? 1 : 0
  return amp
}

/** Ideal 16×16 phase LCD with 40 µm pixels (fills a 32 × 20 µm window). */
export const lcd = (over: Partial<TransmissiveLcdSpec> = {}): TransmissiveLcdSpec => ({
  kind: 'transmissive-lcd',
  id: 'lcd',
  pixels: { resolution: { x: 16, y: 16 }, pitch: { x: 40e-6, y: 40e-6 }, fillFactor: 1, offset: { x: 0, y: 0 } },
  modulation: { kind: 'phase', phaseRange: 2 * Math.PI, levels: 0, response: { kind: 'linear' } },
  clearTransmission: 1,
  surfaces: { front: { transmission: 1, reflection: 0 }, back: { transmission: 1, reflection: 0 } },
  polarizerTransmission: 1,
  deadZoneTransmission: 0,
  switchingTime: 0.01,
  designWavelength: 650e-9,
  program: { kind: 'zero' },
  ...over,
})
