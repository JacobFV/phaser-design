import type { Field, GridSpec } from '../field/grid'
import { multiplyReal } from '../field/grid'

/**
 * Numerical transverse boundary of the simulation window. This is a physics/numerics choice, never a rendering one.
 *
 *  - periodic:  raw FFT wraparound. Light leaving one edge re-enters the opposite edge. Only physically meaningful
 *               when the modelled system really is periodic (or as an explicit idealisation) — select it deliberately.
 *  - absorbing: a smooth amplitude taper of the outer `widthFraction` of the window, applied after every propagation
 *               segment, so energy reaching the edge is removed instead of wrapping into spurious coupling.
 */
export type BoundarySpec =
  | { kind: 'periodic' }
  | { kind: 'absorbing'; widthFraction: number }

export function buildBoundaryWindow(grid: GridSpec, spec: BoundarySpec): Float64Array | null {
  if (spec.kind === 'periodic') return null
  const axis = (n: number) => {
    const w = new Float64Array(n)
    const edge = Math.max(1, Math.round(n * spec.widthFraction))
    for (let i = 0; i < n; i++) {
      const d = Math.min(i, n - 1 - i)
      w[i] = d >= edge ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * d) / edge)
    }
    return w
  }
  const wx = axis(grid.nx)
  const wy = axis(grid.ny)
  const w = new Float64Array(grid.nx * grid.ny)
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) w[j * grid.nx + i] = wx[i] * wy[j]
  return w
}

export function applyBoundary(field: Field, window: Float64Array | null): void {
  if (window) multiplyReal(field, window)
}
