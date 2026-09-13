import { angularFrequency, fft2 } from '../field/fft'
import { createField, type Field, type GridSpec } from '../field/grid'
import type { ResolvedMedium } from '../media/media'

/**
 * Scalar angular-spectrum propagation through a homogeneous medium:
 *   E(z+L) = F⁻¹{ F{E} · H },  H = exp(i (k_z − k) L) · exp(−αL/2),  k = 2πn/λ,  k_z = √(k² − k_x² − k_y²)
 *
 * The on-axis carrier phase e^{ikL} is removed: it is common to every sample on a single optical route,
 * and the route's optical path length is tracked separately for timing. Evanescent components decay.
 * k_z does not separate in x and y, so diagonal spatial frequencies couple correctly.
 */
export interface PropagationKernel {
  readonly key: string
  readonly length: number
  readonly re: Float64Array
  readonly im: Float64Array
}

export function buildKernel(grid: GridSpec, lambda: number, length: number, medium: ResolvedMedium): PropagationKernel {
  const { nx, ny, dx, dy } = grid
  const h = createField(grid)
  const k = (2 * Math.PI * medium.n) / lambda
  const decay = Math.exp((-medium.alpha * length) / 2) // amplitude factor for power attenuation α
  for (let j = 0; j < ny; j++) {
    const ky = angularFrequency(j, ny, dy)
    for (let i = 0; i < nx; i++) {
      const kx = angularFrequency(i, nx, dx)
      const kz2 = k * k - kx * kx - ky * ky
      const idx = j * nx + i
      if (kz2 > 0) {
        const ph = (Math.sqrt(kz2) - k) * length
        h.re[idx] = Math.cos(ph) * decay
        h.im[idx] = Math.sin(ph) * decay
      } else {
        h.re[idx] = Math.exp(-Math.sqrt(-kz2) * length) * decay
      }
    }
  }
  return { key: kernelKey(grid, lambda, length, medium), length, re: h.re, im: h.im }
}

const kernelKey = (g: GridSpec, lambda: number, L: number, m: ResolvedMedium) =>
  `${g.nx}x${g.ny}|${g.dx}|${g.dy}|${lambda}|${L}|${m.n}|${m.alpha}`

/** Repeated identical segments (same grid, λ, length, medium) share one kernel. */
export class KernelCache {
  private map = new Map<string, PropagationKernel>()
  get(grid: GridSpec, lambda: number, length: number, medium: ResolvedMedium): PropagationKernel {
    const key = kernelKey(grid, lambda, length, medium)
    let kern = this.map.get(key)
    if (!kern) {
      kern = buildKernel(grid, lambda, length, medium)
      this.map.set(key, kern)
    }
    return kern
  }
  get size() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
}

/** spectrum · H → out (out may alias spectrum). */
export function applyKernel(spectrum: Field, kern: PropagationKernel, out: Field): void {
  const { re, im } = spectrum
  for (let i = 0; i < re.length; i++) {
    const r = re[i] * kern.re[i] - im[i] * kern.im[i]
    out.im[i] = re[i] * kern.im[i] + im[i] * kern.re[i]
    out.re[i] = r
  }
}

/** Propagate a real-space field in place. */
export function propagate(field: Field, kern: PropagationKernel): void {
  fft2(field)
  applyKernel(field, kern, field)
  fft2(field, true)
}
