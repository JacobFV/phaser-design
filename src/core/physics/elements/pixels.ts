import type { AssetResolver } from '../assets'
import { sampleX, sampleY, type GridSpec } from '../field/grid'
import { mulberry32 } from '../../common/random'
import type { MaskProgram, PhaseResponse, PixelArray } from './types'

/** Which device pixel each field sample falls in: −1 outside the active area, −2 inside the inter-pixel dead zone. */
export function buildPixelMap(grid: GridSpec, px: PixelArray): Int32Array {
  const map = new Int32Array(grid.nx * grid.ny)
  const fx = Math.sqrt(px.fillFactor) // linear fill fraction per axis
  const fy = fx
  for (let j = 0; j < grid.ny; j++) {
    const v = (sampleY(grid, j) - px.offset.y) / px.pitch.y + px.resolution.y / 2
    const py = Math.floor(v)
    const inY = py >= 0 && py < px.resolution.y
    const fracY = Math.abs(v - py - 0.5) <= fy / 2
    for (let i = 0; i < grid.nx; i++) {
      const u = (sampleX(grid, i) - px.offset.x) / px.pitch.x + px.resolution.x / 2
      const pxi = Math.floor(u)
      const idx = j * grid.nx + i
      if (!inY || pxi < 0 || pxi >= px.resolution.x) map[idx] = -1
      else if (!fracY || Math.abs(u - pxi - 0.5) > fx / 2) map[idx] = -2
      else map[idx] = py * px.resolution.x + pxi
    }
  }
  return map
}

/** Commanded value per device pixel (row-major) for a program. */
export function evaluateProgram(program: MaskProgram, resX: number, resY: number, assets: AssetResolver): Float64Array {
  const out = new Float64Array(resX * resY)
  const TAU = 2 * Math.PI
  switch (program.kind) {
    case 'zero':
      return out
    case 'random': {
      const rand = mulberry32(program.seed)
      for (let i = 0; i < out.length; i++) out[i] = TAU * program.depth * rand()
      return out
    }
    case 'grating': {
      const P = program.periodPx
      for (let y = 0; y < resY; y++)
        for (let x = 0; x < resX; x++) {
          const u = program.orientation === 'x' ? x : program.orientation === 'y' ? y : program.orientation === 'diagonal' ? x + y : x - y
          out[y * resX + x] = (TAU * program.depth * (((u % P) + P) % P)) / P
        }
      return out
    }
    case 'lenslets': {
      const g = program.groupPx
      for (let y = 0; y < resY; y++)
        for (let x = 0; x < resX; x++) {
          const ux = (x % g) - (g - 1) / 2
          const uy = (y % g) - (g - 1) / 2
          out[y * resX + x] = (-TAU * program.depth * (ux * ux + uy * uy)) / ((g / 2) * (g / 2))
        }
      return out
    }
    case 'array': {
      if (program.ref.width !== resX || program.ref.height !== resY)
        throw new Error(`program ${program.ref.id} is ${program.ref.width}×${program.ref.height}, device is ${resX}×${resY}`)
      out.set(assets.get(program.ref))
      return out
    }
  }
}

function response(u: number, r: PhaseResponse): number {
  switch (r.kind) {
    case 'linear':
      return u
    case 'gamma':
      return Math.pow(u, r.gamma)
    case 'lut': {
      const t = r.table
      if (t.length < 2) return t[0] ?? u
      const s = u * (t.length - 1)
      const k = Math.min(t.length - 2, Math.floor(s))
      return t[k] + (t[k + 1] - t[k]) * (s - k)
    }
  }
}

/**
 * Commanded phase → achieved phase for a real device: wrap to one 2π, express as a fraction of the usable stroke,
 * clip, quantise to the available levels, pass through the calibration curve, and scale off the design wavelength.
 */
export function achievedPhase(cmd: number, range: number, levels: number, resp: PhaseResponse, designLambda: number, lambda: number): number {
  const TAU = 2 * Math.PI
  let u = (((cmd % TAU) + TAU) % TAU) / range
  u = Math.min(1, Math.max(0, u))
  if (levels >= 2) u = Math.round(u * (levels - 1)) / (levels - 1)
  return response(u, resp) * range * (designLambda / lambda)
}

/** Normalised drive level for amplitude devices. */
export function driveLevel(cmd: number, levels: number): number {
  const TAU = 2 * Math.PI
  let u = (((cmd % TAU) + TAU) % TAU) / TAU
  if (levels >= 2) u = Math.round(u * (levels - 1)) / (levels - 1)
  return u
}
