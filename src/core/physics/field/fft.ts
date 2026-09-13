import type { Field } from './grid'

/**
 * Radix-2 FFT with per-size cached plans.
 * Convention: forward is unnormalised, inverse divides by n, so forward∘inverse is the identity and
 * a unit-modulus transfer function between them conserves Σ|E|² (Parseval).
 */
class FftPlan {
  readonly rev: Uint32Array
  readonly cos: Float64Array
  readonly sin: Float64Array
  constructor(readonly n: number) {
    this.rev = new Uint32Array(n)
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      this.rev[i] = j
    }
    this.cos = new Float64Array(n >> 1)
    this.sin = new Float64Array(n >> 1)
    for (let k = 0; k < n >> 1; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n)
      this.sin[k] = Math.sin((2 * Math.PI * k) / n)
    }
  }
}

const plans = new Map<number, FftPlan>()
function plan(n: number): FftPlan {
  let p = plans.get(n)
  if (!p) {
    if ((n & (n - 1)) !== 0) throw new Error(`fft size must be a power of two, got ${n}`)
    p = new FftPlan(n)
    plans.set(n, p)
  }
  return p
}

export function fft1(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (n < 2) return
  const { rev, cos, sin } = plan(n)
  for (let i = 1; i < n; i++) {
    const j = rev[i]
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  const sgn = inverse ? -1 : 1
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const stride = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride]
        const wi = sgn * sin[k * stride]
        const a = i + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  if (inverse) {
    const s = 1 / n
    for (let i = 0; i < n; i++) {
      re[i] *= s
      im[i] *= s
    }
  }
}

const scratch = new Map<number, { re: Float64Array; im: Float64Array }>()
function lineBuffer(n: number) {
  let b = scratch.get(n)
  if (!b) {
    b = { re: new Float64Array(n), im: new Float64Array(n) }
    scratch.set(n, b)
  }
  return b
}

/** Separable 2-D FFT in place: every row, then every column. */
export function fft2(f: Field, inverse = false): void {
  const { nx, ny } = f.grid
  const row = lineBuffer(nx)
  for (let j = 0; j < ny; j++) {
    const o = j * nx
    for (let i = 0; i < nx; i++) { row.re[i] = f.re[o + i]; row.im[i] = f.im[o + i] }
    fft1(row.re, row.im, inverse)
    for (let i = 0; i < nx; i++) { f.re[o + i] = row.re[i]; f.im[o + i] = row.im[i] }
  }
  const col = lineBuffer(ny)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) { col.re[j] = f.re[j * nx + i]; col.im[j] = f.im[j * nx + i] }
    fft1(col.re, col.im, inverse)
    for (let j = 0; j < ny; j++) { f.re[j * nx + i] = col.re[j]; f.im[j * nx + i] = col.im[j] }
  }
}

/** Angular spatial frequency (rad/m) of FFT bin b on an axis with n samples at spacing d. */
export const angularFrequency = (b: number, n: number, d: number) => (2 * Math.PI * (b < n / 2 ? b : b - n)) / (n * d)
