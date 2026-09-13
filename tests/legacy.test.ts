// Characterisation of the original single-chamber engine, frozen in tests/fixtures/legacy.
// These pin the behaviour the generic engine must reproduce (see regression.test.ts).
import { describe, expect, it } from 'vitest'
import { Cavity } from './fixtures/legacy/cavity'
import { DEFAULT_PARAMS, LCD_PIXELS, N } from './fixtures/legacy/params'

export function legacyRing(): Float32Array {
  const L = LCD_PIXELS
  const amp = new Float32Array(L * L)
  for (let y = 0; y < L; y++)
    for (let x = 0; x < L; x++) amp[y * L + x] = Math.abs(Math.hypot(x - 32, y - 32) - 20) < 2.5 ? 1 : 0
  return amp
}

const meanRow = (I: Float32Array, r: number) => {
  let s = 0
  for (let i = 0; i < N; i++) s += I[r * N + i]
  return s / N
}

describe('legacy cavity (frozen reference)', () => {
  it('saturable gain settles where G_eff equals the inverse passive retention', () => {
    const cav = new Cavity({ ...DEFAULT_PARAMS }, legacyRing())
    let rec = cav.step(null)
    for (let i = 0; i < 60; i++) rec = cav.step(null)
    const p = DEFAULT_PARAMS
    const passive = p.rIn * p.rOut * Math.pow(p.tLcd, 2 * p.nLcd) * Math.pow(0.998, 2 * (p.nLcd + 1) * p.dSepMm * 1e-3)
    expect(rec.gainEff).toBeCloseTo(1 / passive, 2)
  })

  it('side-view projections conserve the mean intensity of the full 2-D field', () => {
    const cav = new Cavity({ ...DEFAULT_PARAMS }, legacyRing())
    const rec = cav.step(null)
    const img = rec.images.h0
    let p = 0
    for (let i = 0; i < img.length; i += 2) p += img[i] ** 2 + img[i + 1] ** 2
    expect(meanRow(rec.down.I, 0)).toBeCloseTo(p / (img.length / 2), 5)
  })

  it('is deterministic for a fixed seed', () => {
    const a = new Cavity({ ...DEFAULT_PARAMS }, legacyRing())
    const b = new Cavity({ ...DEFAULT_PARAMS }, legacyRing())
    for (let i = 0; i < 3; i++) {
      a.step(null)
      b.step(null)
    }
    expect(a.step(null).energy).toBe(b.step(null).energy)
  })
})
