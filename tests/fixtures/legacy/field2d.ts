import { fft } from './fft'
import { LCD_PIXELS, N, OVERSAMPLE, type MaskProgram } from './params'

/** Complex scalar field on an N × N transverse grid, row-major: index = y * N + x. */
export interface Field2 {
  re: Float64Array
  im: Float64Array
}

export const newField2 = (): Field2 => ({ re: new Float64Array(N * N), im: new Float64Array(N * N) })
export const cloneField2 = (f: Field2): Field2 => ({ re: f.re.slice(), im: f.im.slice() })

export function power2(f: Field2): number {
  let p = 0
  for (let i = 0; i < f.re.length; i++) p += f.re[i] * f.re[i] + f.im[i] * f.im[i]
  return p / f.re.length
}

export function scale2(f: Field2, a: number): void {
  for (let i = 0; i < f.re.length; i++) {
    f.re[i] *= a
    f.im[i] *= a
  }
}

/** Pack a field as interleaved float32 (re, im) for transfer to the UI thread. */
export function pack(f: Field2): Float32Array {
  const out = new Float32Array(f.re.length * 2)
  for (let i = 0; i < f.re.length; i++) {
    out[2 * i] = f.re[i]
    out[2 * i + 1] = f.im[i]
  }
  return out
}

const tr = new Float64Array(N)
const ti = new Float64Array(N)

/** Separable 2-D FFT: every row, then every column. */
export function fft2(f: Field2, inverse = false): void {
  for (let y = 0; y < N; y++) {
    const o = y * N
    for (let x = 0; x < N; x++) { tr[x] = f.re[o + x]; ti[x] = f.im[o + x] }
    fft(tr, ti, inverse)
    for (let x = 0; x < N; x++) { f.re[o + x] = tr[x]; f.im[o + x] = ti[x] }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) { tr[y] = f.re[y * N + x]; ti[y] = f.im[y * N + x] }
    fft(tr, ti, inverse)
    for (let y = 0; y < N; y++) { f.re[y * N + x] = tr[y]; f.im[y * N + x] = ti[y] }
  }
}

/**
 * Angular-spectrum transfer function H(kx, ky; dz) with the carrier e^{ikdz} removed.
 * kz = √(k² − kx² − ky²) does not separate in x and y, so diagonal spatial frequencies
 * pick up different phase than the axes — the 2-D coupling a 1-D model can't see.
 */
export function transfer2(dxM: number, lambdaM: number, dzM: number): Field2 {
  const h = newField2()
  const k = (2 * Math.PI) / lambdaM
  const dk = (2 * Math.PI) / (N * dxM)
  for (let y = 0; y < N; y++) {
    const ky = (y < N / 2 ? y : y - N) * dk
    for (let x = 0; x < N; x++) {
      const kx = (x < N / 2 ? x : x - N) * dk
      const kz2 = k * k - kx * kx - ky * ky
      const i = y * N + x
      if (kz2 > 0) {
        const ph = (Math.sqrt(kz2) - k) * dzM
        h.re[i] = Math.cos(ph)
        h.im[i] = Math.sin(ph)
      } else {
        h.re[i] = Math.exp(-Math.sqrt(-kz2) * dzM)
      }
    }
  }
  return h
}

/** out = F · H (element-wise, complex). */
export function mulSpec(F: Field2, H: Field2, out: Field2): void {
  for (let i = 0; i < F.re.length; i++) {
    const r = F.re[i] * H.re[i] - F.im[i] * H.im[i]
    out.im[i] = F.re[i] * H.im[i] + F.im[i] * H.re[i]
    out.re[i] = r
  }
}

/**
 * Project the field whose spectrum is F·H onto the x axis without a full inverse 2-D FFT:
 * one inverse 1-D FFT per ky row gives G(x, ky); by Parseval along y,
 *   mean_y |E(x,y)|² = Σ_ky |G|² / N²   (incoherent projection → intensity)
 *   mean_y  E(x,y)   = G(x, ky=0) / N    (coherent projection → phase for the carrier)
 */
export function projectX(F: Field2, H: Field2, I: Float32Array, cre: Float32Array, cim: Float32Array, off: number): void {
  for (let x = 0; x < N; x++) I[off + x] = 0
  for (let y = 0; y < N; y++) {
    const o = y * N
    for (let x = 0; x < N; x++) {
      const a = F.re[o + x], b = F.im[o + x], hr = H.re[o + x], hi = H.im[o + x]
      tr[x] = a * hr - b * hi
      ti[x] = a * hi + b * hr
    }
    fft(tr, ti, true)
    for (let x = 0; x < N; x++) I[off + x] += (tr[x] * tr[x] + ti[x] * ti[x]) / (N * N)
    if (y === 0) for (let x = 0; x < N; x++) { cre[off + x] = tr[x] / N; cim[off + x] = ti[x] / N }
  }
}

/** Projection straight from a spatial field (used where we already have E in real space). */
export function projectSpatial(E: Field2, I: Float32Array, cre: Float32Array, cim: Float32Array, off: number): void {
  for (let x = 0; x < N; x++) { I[off + x] = 0; cre[off + x] = 0; cim[off + x] = 0 }
  for (let y = 0; y < N; y++) {
    const o = y * N
    for (let x = 0; x < N; x++) {
      I[off + x] += (E.re[o + x] ** 2 + E.im[o + x] ** 2) / N
      cre[off + x] += E.re[o + x] / N
      cim[off + x] += E.im[o + x] / N
    }
  }
}

/** Soft absorbing border (used when the chamber walls are set to absorb). */
export function makeAbsorber(): Float64Array {
  const w1 = new Float64Array(N)
  const edge = Math.round(N * 0.08)
  for (let i = 0; i < N; i++) {
    const d = Math.min(i, N - 1 - i)
    w1[i] = d >= edge ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * d) / edge)
  }
  const w = new Float64Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) w[y * N + x] = w1[x] * w1[y]
  return w
}

// Deterministic PRNG so a given seed always programs the same masks.
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A programmable LCD plane: one phase per modulator pixel, row-major LCD_PIXELS². */
export type Mask2 = Float64Array

export function programMask2(program: MaskProgram, depth: number, index: number, rand: () => number): Mask2 {
  const L = LCD_PIXELS
  const m = new Float64Array(L * L)
  const full = 2 * Math.PI * depth
  for (let py = 0; py < L; py++) {
    for (let px = 0; px < L; px++) {
      let ph = 0
      switch (program) {
        case 'random':
          ph = full * rand()
          break
        case 'grating': {
          // blazed ramp along a diagonal that rotates 90° each plane
          const period = 12
          const u = index % 2 === 0 ? px + py : px - py
          ph = (full * (((u % period) + period) % period)) / period
          break
        }
        case 'lenslets': {
          const g = 16
          const ux = (px % g) - (g - 1) / 2
          const uy = (py % g) - (g - 1) / 2
          ph = (-full * (ux * ux + uy * uy)) / ((g / 2) * (g / 2))
          break
        }
        case 'off':
          ph = 0
      }
      m[py * L + px] = ph
    }
  }
  return m
}

/** Apply an LCD phase mask (nearest-neighbour upsampled) with optional absorber and transmission. */
export function applyMask2(f: Field2, mask: Mask2, absorber: Float64Array | null, amp: number): void {
  for (let y = 0; y < N; y++) {
    const my = ((y / OVERSAMPLE) | 0) * LCD_PIXELS
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      const ph = mask[my + ((x / OVERSAMPLE) | 0)]
      const a = absorber ? absorber[i] * amp : amp
      const c = Math.cos(ph) * a
      const s = Math.sin(ph) * a
      const r = f.re[i] * c - f.im[i] * s
      f.im[i] = f.re[i] * s + f.im[i] * c
      f.re[i] = r
    }
  }
}

/** Upsample an LCD_PIXELS² amplitude pattern into a unit-mean-power field. */
export function inputField2(amp: Float32Array): Field2 {
  const f = newField2()
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      f.re[y * N + x] = amp[((y / OVERSAMPLE) | 0) * LCD_PIXELS + ((x / OVERSAMPLE) | 0)]
  const p = power2(f)
  if (p > 0) scale2(f, 1 / Math.sqrt(p))
  return f
}

/** Thin lens → CCD at the focal plane: centred |FT|². */
export function focalPlane2(f: Field2): Float32Array {
  const g = cloneField2(f)
  fft2(g)
  const out = new Float32Array(N * N)
  const h = N / 2
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const j = ((y + h) % N) * N + ((x + h) % N)
      out[y * N + x] = (g.re[j] ** 2 + g.im[j] ** 2) / (N * N)
    }
  return out
}
