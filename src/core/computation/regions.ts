import type { Vec2 } from '../physics/elements/types'
import { sampleX, sampleY, type Field, type GridSpec } from '../physics/field/grid'
import type { DetectorImage } from '../physics/system'

/**
 * Computational interpretation of the physical field. A region is a patch of the transverse plane split into cells;
 * its encoding says how a cell's light maps to numbers. Nothing here knows which algorithm uses the numbers.
 */
export type RegionBounds =
  | { kind: 'rect'; center: Vec2; size: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }

export type EncodingSpec =
  | { kind: 'intensity' } // mean |E|² per cell
  | { kind: 'amplitude' } // real amplitude per cell (encode) / √(mean |E|²) (decode)
  | { kind: 'phase' } // arg of the summed field per cell
  | { kind: 'complex' } // mean E per cell → 2 values (re, im)
  | { kind: 'differential-intensity'; axis: 'x' | 'y' } // (I₊ − I₋)/(I₊ + I₋) across the two halves of each cell
  | { kind: 'blob-mode'; sigma: number } // power in a Gaussian mode (rms radius σ, m) centred on each cell

export interface ComputationalRegionSpec {
  id: string
  bounds: RegionBounds
  cells: { x: number; y: number }
  encoding: EncodingSpec
  role?: string // free-form label for authors ("visual", "memory", "action"); never interpreted by the core
}

export type PortSpec =
  | { id: string; direction: 'input'; region: string; physicalPort: string; normalization: InputNormalization }
  | { id: string; direction: 'output'; region: string; source: PortSource }

export type InputNormalization = { kind: 'none' } | { kind: 'mean-intensity'; value: number }

export type PortSource =
  | { kind: 'cavity' } // the circulating field at the route start
  | { kind: 'tap'; tap: string } // a recorded out-coupled field
  | { kind: 'readout'; readout: string } // a detector image (intensity-only encodings)

export interface ComputationConfig {
  regions: ComputationalRegionSpec[]
  ports: PortSpec[]
}

export const valuesPerCell = (e: EncodingSpec) => (e.kind === 'complex' ? 2 : 1)

interface CellSamples {
  plus: Int32Array // sample indices (for differential encodings: the + half)
  minus: Int32Array // − half (differential only)
  center: Vec2
}

export class CompiledRegion {
  readonly cells: CellSamples[] = []
  readonly dims: number
  /** blob-mode: per-cell Gaussian weights over `plus`, normalised so Σ g² dA = 1 */
  private weights: Float64Array[] = []

  constructor(readonly spec: ComputationalRegionSpec, readonly grid: GridSpec) {
    const { bounds, cells, encoding } = spec
    const box = bounds.kind === 'rect'
      ? { cx: bounds.center.x, cy: bounds.center.y, w: bounds.size.x, h: bounds.size.y }
      : { cx: bounds.center.x, cy: bounds.center.y, w: 2 * bounds.radius, h: 2 * bounds.radius }
    const cw = box.w / cells.x
    const ch = box.h / cells.y
    const buckets = Array.from({ length: cells.x * cells.y }, () => ({ plus: [] as number[], minus: [] as number[] }))
    for (let j = 0; j < grid.ny; j++) {
      const y = sampleY(grid, j)
      const v = (y - (box.cy - box.h / 2)) / ch
      const cy = Math.floor(v)
      if (cy < 0 || cy >= cells.y) continue
      for (let i = 0; i < grid.nx; i++) {
        const x = sampleX(grid, i)
        if (bounds.kind === 'circle' && Math.hypot(x - bounds.center.x, y - bounds.center.y) > bounds.radius) continue
        const u = (x - (box.cx - box.w / 2)) / cw
        const cx = Math.floor(u)
        if (cx < 0 || cx >= cells.x) continue
        const b = buckets[cy * cells.x + cx]
        const idx = j * grid.nx + i
        if (encoding.kind === 'differential-intensity') {
          const frac = encoding.axis === 'x' ? u - cx : v - cy
          ;(frac < 0.5 ? b.plus : b.minus).push(idx)
        } else b.plus.push(idx)
      }
    }
    buckets.forEach((b, k) => {
      const cx = k % cells.x
      const cy = Math.floor(k / cells.x)
      const center = { x: box.cx - box.w / 2 + (cx + 0.5) * cw, y: box.cy - box.h / 2 + (cy + 0.5) * ch }
      this.cells.push({ plus: Int32Array.from(b.plus), minus: Int32Array.from(b.minus), center })
    })
    if (encoding.kind === 'blob-mode') {
      // modes extend over the whole window so neighbouring overlap (cross-talk) is measured, not truncated
      for (const cell of this.cells) {
        const w = new Float64Array(grid.nx * grid.ny)
        let norm = 0
        for (let j = 0; j < grid.ny; j++)
          for (let i = 0; i < grid.nx; i++) {
            const r2 = (sampleX(grid, i) - cell.center.x) ** 2 + (sampleY(grid, j) - cell.center.y) ** 2
            const g = Math.exp(-r2 / (4 * encoding.sigma * encoding.sigma)) // amplitude of an intensity-σ Gaussian
            w[j * grid.nx + i] = g
            norm += g * g * grid.dx * grid.dy
          }
        const s = 1 / Math.sqrt(norm)
        for (let i = 0; i < w.length; i++) w[i] *= s
        this.weights.push(w)
      }
    }
    this.dims = this.cells.length * valuesPerCell(encoding)
  }

  emptyCells(): number {
    return this.cells.filter((c) => c.plus.length === 0 && c.minus.length === 0).length
  }

  /** Decode the complex field into this region's values. */
  decodeField(f: Field, out = new Float64Array(this.dims)): Float64Array {
    const enc = this.spec.encoding
    const dA = this.grid.dx * this.grid.dy
    this.cells.forEach((cell, k) => {
      const meanI = (idx: Int32Array) => {
        let s = 0
        for (let n = 0; n < idx.length; n++) s += f.re[idx[n]] ** 2 + f.im[idx[n]] ** 2
        return idx.length ? s / idx.length : 0
      }
      switch (enc.kind) {
        case 'intensity': out[k] = meanI(cell.plus); break
        case 'amplitude': out[k] = Math.sqrt(meanI(cell.plus)); break
        case 'differential-intensity': {
          const a = meanI(cell.plus), b = meanI(cell.minus)
          out[k] = a + b > 0 ? (a - b) / (a + b) : 0
          break
        }
        case 'phase':
        case 'complex': {
          let re = 0, im = 0
          for (let n = 0; n < cell.plus.length; n++) { re += f.re[cell.plus[n]]; im += f.im[cell.plus[n]] }
          const c = cell.plus.length || 1
          if (enc.kind === 'phase') out[k] = Math.atan2(im, re)
          else { out[2 * k] = re / c; out[2 * k + 1] = im / c }
          break
        }
        case 'blob-mode': {
          const w = this.weights[k]
          let re = 0, im = 0
          for (let i = 0; i < w.length; i++) { re += w[i] * f.re[i]; im += w[i] * f.im[i] }
          out[k] = (re * re + im * im) * dA * dA // |⟨g|E⟩|² = power in the mode
          break
        }
      }
    })
    return out
  }

  /** Decode an intensity-only detector image (resampled by nearest detector pixel). */
  decodeImage(img: DetectorImage, out = new Float64Array(this.dims)): Float64Array {
    const enc = this.spec.encoding
    if (enc.kind === 'phase' || enc.kind === 'complex') throw new Error(`region ${this.spec.id}: a detector image has no phase`)
    const lookup = (idx: number) => {
      const x = sampleX(this.grid, idx % this.grid.nx)
      const y = sampleY(this.grid, Math.floor(idx / this.grid.nx))
      const i = Math.floor(x / img.pixelSize.x + img.nx / 2)
      const j = Math.floor(y / img.pixelSize.y + img.ny / 2)
      return i >= 0 && i < img.nx && j >= 0 && j < img.ny ? img.intensity[j * img.nx + i] : 0
    }
    this.cells.forEach((cell, k) => {
      const mean = (idx: Int32Array) => {
        let s = 0
        for (let n = 0; n < idx.length; n++) s += lookup(idx[n])
        return idx.length ? s / idx.length : 0
      }
      if (enc.kind === 'differential-intensity') {
        const a = mean(cell.plus), b = mean(cell.minus)
        out[k] = a + b > 0 ? (a - b) / (a + b) : 0
      } else if (enc.kind === 'amplitude') out[k] = Math.sqrt(mean(cell.plus))
      else out[k] = mean(cell.plus)
    })
    return out
  }

  /** Encode values into a field contribution (added to `out`). */
  encode(values: ArrayLike<number>, out: Field): void {
    if (values.length !== this.dims) throw new Error(`region ${this.spec.id} expects ${this.dims} values, got ${values.length}`)
    const enc = this.spec.encoding
    this.cells.forEach((cell, k) => {
      const v = values[enc.kind === 'complex' ? 2 * k : k]
      const fillAll = (idx: Int32Array, re: number, im: number) => {
        for (let n = 0; n < idx.length; n++) { out.re[idx[n]] += re; out.im[idx[n]] += im }
      }
      switch (enc.kind) {
        case 'intensity': fillAll(cell.plus, Math.sqrt(Math.max(0, v)), 0); break
        case 'amplitude': fillAll(cell.plus, v, 0); break
        case 'phase': fillAll(cell.plus, Math.cos(v), Math.sin(v)); break
        case 'complex': fillAll(cell.plus, v, values[2 * k + 1]); break
        case 'differential-intensity': {
          const c = Math.max(-1, Math.min(1, v))
          fillAll(cell.plus, Math.sqrt((1 + c) / 2), 0)
          fillAll(cell.minus, Math.sqrt((1 - c) / 2), 0)
          break
        }
        case 'blob-mode': {
          const w = this.weights[k]
          for (let i = 0; i < w.length; i++) out.re[i] += v * w[i]
          break
        }
      }
    })
  }

  /** Fraction of the field's power that lies inside this region's cells. */
  powerFraction(f: Field): number {
    let inside = 0, total = 0
    for (let i = 0; i < f.re.length; i++) total += f.re[i] ** 2 + f.im[i] ** 2
    for (const c of this.cells) {
      for (const idx of [c.plus, c.minus]) for (let n = 0; n < idx.length; n++) inside += f.re[idx[n]] ** 2 + f.im[idx[n]] ** 2
    }
    return total > 0 ? inside / total : 0
  }
}

export class CompiledComputation {
  readonly regions = new Map<string, CompiledRegion>()
  readonly ports = new Map<string, PortSpec>()
  readonly warnings: string[] = []

  constructor(readonly config: ComputationConfig, grid: GridSpec) {
    for (const r of config.regions) {
      if (this.regions.has(r.id)) throw new Error(`duplicate region id ${r.id}`)
      const compiled = new CompiledRegion(r, grid)
      this.regions.set(r.id, compiled)
      const empty = compiled.emptyCells()
      if (empty) this.warnings.push(`region ${r.id}: ${empty} cell(s) contain no field samples (cells finer than the grid)`)
    }
    for (const p of config.ports) {
      if (this.ports.has(p.id)) throw new Error(`duplicate port id ${p.id}`)
      const region = this.regions.get(p.region)
      if (!region) throw new Error(`port ${p.id} references unknown region ${p.region}`)
      if (p.direction === 'output' && p.source.kind === 'readout' && (region.spec.encoding.kind === 'phase' || region.spec.encoding.kind === 'complex'))
        throw new Error(`port ${p.id}: detector readouts carry no phase; use an intensity-type encoding`)
      this.ports.set(p.id, p)
    }
  }

  region(id: string): CompiledRegion {
    const r = this.regions.get(id)
    if (!r) throw new Error(`unknown region ${id}`)
    return r
  }

  port(id: string): PortSpec {
    const p = this.ports.get(id)
    if (!p) throw new Error(`unknown port ${id}`)
    return p
  }
}
