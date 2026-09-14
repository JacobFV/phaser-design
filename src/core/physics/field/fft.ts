import type { Field } from './grid'

/**
 * Radix-2 FFT with per-size cached plans.
 * Convention: forward is unnormalised, inverse divides by n, so forward∘inverse is the identity and
 * a unit-modulus transfer function between them conserves Σ|E|² (Parseval).
 */
class FftPlan {
  readonly rev: Uint32Array
  /** Roots for every level: stage `half` (butterfly span 2·half) keeps its roots contiguous at [half, 2·half). */
  readonly cos: Float64Array
  readonly sinForward: Float64Array
  readonly sinInverse: Float64Array
  constructor(readonly n: number) {
    this.rev = new Uint32Array(n)
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      this.rev[i] = j
    }
    this.cos = new Float64Array(n)
    this.sinForward = new Float64Array(n)
    this.sinInverse = new Float64Array(n)
    for (let half = 1; half < n; half <<= 1) {
      const stride = n / (2 * half)
      for (let k = 0; k < half; k++) {
        const m = k * stride
        this.cos[half + k] = Math.cos((2 * Math.PI * m) / n)
        this.sinForward[half + k] = Math.sin((2 * Math.PI * m) / n)
        this.sinInverse[half + k] = -Math.sin((2 * Math.PI * m) / n)
      }
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

/** In-place transform of the n samples starting at `off`, so rows of a 2-D field need no copy. */
function transform(re: Float64Array, im: Float64Array, off: number, n: number, p: FftPlan, inverse: boolean): void {
  const rev = p.rev
  for (let i = 1; i < n; i++) {
    const j = rev[i]
    if (i < j) {
      const a = off + i, b = off + j
      let t = re[a]; re[a] = re[b]; re[b] = t
      t = im[a]; im[a] = im[b]; im[b] = t
    }
  }
  const end = off + n
  // span 2: the only root is 1
  for (let a = off; a < end; a += 2) {
    const b = a + 1
    const xr = re[b], xi = im[b]
    re[b] = re[a] - xr
    im[b] = im[a] - xi
    re[a] += xr
    im[a] += xi
  }
  const cos = p.cos
  const sin = inverse ? p.sinInverse : p.sinForward
  for (let half = 2; half < n; half <<= 1) {
    const len = half << 1
    for (let i = off; i < end; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[half + k]
        const wi = sin[half + k]
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
    for (let i = off; i < end; i++) {
      re[i] *= s
      im[i] *= s
    }
  }
}

export function fft1(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (n < 2) return
  transform(re, im, 0, n, plan(n), inverse)
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
  const { re, im } = f
  if (nx >= 2) {
    const p = plan(nx)
    for (let j = 0; j < ny; j++) transform(re, im, j * nx, nx, p, inverse)
  }
  if (ny < 2) return
  const p = plan(ny)
  const col = lineBuffer(ny)
  for (let i = 0; i < nx; i++) {
    for (let j = 0, k = i; j < ny; j++, k += nx) { col.re[j] = re[k]; col.im[j] = im[k] }
    transform(col.re, col.im, 0, ny, p, inverse)
    for (let j = 0, k = i; j < ny; j++, k += nx) { re[k] = col.re[j]; im[k] = col.im[j] }
  }
}

/** Angular spatial frequency (rad/m) of FFT bin b on an axis with n samples at spacing d. */
export const angularFrequency = (b: number, n: number, d: number) => (2 * Math.PI * (b < n / 2 ? b : b - n)) / (n * d)
