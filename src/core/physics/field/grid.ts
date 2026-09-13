/**
 * Transverse sampling grid and complex scalar field.
 *
 * Units and normalisation (used consistently across the core):
 *  - lengths in metres, times in seconds, phases in radians
 *  - a field sample E is a complex amplitude in √(W/m²) (arbitrary but consistent scale)
 *  - optical power P = Σ |E|² · dx · dy                                    [W]
 *  - mean intensity  = Σ |E|² / (nx · ny)                                  [W/m²]
 *  - every `transmission` / `reflectivity` / `retained` parameter in configs is a POWER fraction;
 *    elements convert to amplitude with √ internally.
 *
 * Sample (i, j) sits at x = (i − nx/2 + ½)·dx, y = (j − ny/2 + ½)·dy, so the grid is centred on the optical axis.
 * A future Jones-vector field can add components alongside `re/im` without changing GridSpec.
 */
export interface GridSpec {
  nx: number // samples along x (power of two)
  ny: number // samples along y (power of two)
  dx: number // sample spacing, m
  dy: number // sample spacing, m
}

export interface Field {
  readonly grid: GridSpec
  readonly re: Float64Array // row-major: index = j * nx + i
  readonly im: Float64Array
}

const isPow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0

export function validateGrid(g: GridSpec): void {
  if (!isPow2(g.nx) || !isPow2(g.ny)) throw new Error(`grid dimensions must be powers of two, got ${g.nx}×${g.ny}`)
  if (!(g.dx > 0) || !(g.dy > 0)) throw new Error('grid spacing must be positive')
}

export const sameGrid = (a: GridSpec, b: GridSpec) => a.nx === b.nx && a.ny === b.ny && a.dx === b.dx && a.dy === b.dy

export function createField(grid: GridSpec): Field {
  validateGrid(grid)
  const n = grid.nx * grid.ny
  return { grid, re: new Float64Array(n), im: new Float64Array(n) }
}

export function cloneField(f: Field): Field {
  return { grid: f.grid, re: f.re.slice(), im: f.im.slice() }
}

export function copyField(dst: Field, src: Field): void {
  dst.re.set(src.re)
  dst.im.set(src.im)
}

export function zeroField(f: Field): void {
  f.re.fill(0)
  f.im.fill(0)
}

export const sampleX = (g: GridSpec, i: number) => (i - g.nx / 2 + 0.5) * g.dx
export const sampleY = (g: GridSpec, j: number) => (j - g.ny / 2 + 0.5) * g.dy
export const gridExtent = (g: GridSpec) => ({ width: g.nx * g.dx, height: g.ny * g.dy })

/** Σ|E|² — the dimensionless sum; multiply by dx·dy for power. */
export function sumIntensity(f: Field): number {
  let s = 0
  for (let i = 0; i < f.re.length; i++) s += f.re[i] * f.re[i] + f.im[i] * f.im[i]
  return s
}

export const fieldPower = (f: Field) => sumIntensity(f) * f.grid.dx * f.grid.dy
export const meanIntensity = (f: Field) => sumIntensity(f) / f.re.length

/** Multiply by a real AMPLITUDE factor (power scales by a²). */
export function scaleField(f: Field, amplitude: number): void {
  if (amplitude === 1) return
  for (let i = 0; i < f.re.length; i++) {
    f.re[i] *= amplitude
    f.im[i] *= amplitude
  }
}

/** dst += a · src (complex a = ar + i·ai). */
export function addScaled(dst: Field, src: Field, ar: number, ai = 0): void {
  for (let i = 0; i < dst.re.length; i++) {
    const r = src.re[i], m = src.im[i]
    dst.re[i] += ar * r - ai * m
    dst.im[i] += ar * m + ai * r
  }
}

/** Multiply by e^{iφ} sample-wise. */
export function multiplyPhase(f: Field, phase: Float64Array): void {
  for (let i = 0; i < f.re.length; i++) {
    const c = Math.cos(phase[i]), s = Math.sin(phase[i])
    const r = f.re[i] * c - f.im[i] * s
    f.im[i] = f.re[i] * s + f.im[i] * c
    f.re[i] = r
  }
}

/** Multiply by a precomputed complex transmission t = tr + i·ti sample-wise. */
export function multiplyComplex(f: Field, tr: Float64Array, ti: Float64Array): void {
  for (let i = 0; i < f.re.length; i++) {
    const r = f.re[i] * tr[i] - f.im[i] * ti[i]
    f.im[i] = f.re[i] * ti[i] + f.im[i] * tr[i]
    f.re[i] = r
  }
}

/** Multiply by a real amplitude window sample-wise. */
export function multiplyReal(f: Field, w: Float64Array): void {
  for (let i = 0; i < f.re.length; i++) {
    f.re[i] *= w[i]
    f.im[i] *= w[i]
  }
}

/** Interleaved float32 (re, im) — the transfer format for snapshots. */
export function packField(f: Field): Float32Array {
  const out = new Float32Array(f.re.length * 2)
  for (let i = 0; i < f.re.length; i++) {
    out[2 * i] = f.re[i]
    out[2 * i + 1] = f.im[i]
  }
  return out
}

export function unpackField(grid: GridSpec, data: ArrayLike<number>): Field {
  const f = createField(grid)
  for (let i = 0; i < f.re.length; i++) {
    f.re[i] = data[2 * i]
    f.im[i] = data[2 * i + 1]
  }
  return f
}
