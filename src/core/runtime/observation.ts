import { fft1, fft2 } from '../physics/field/fft'
import { createField, packField, type Field } from '../physics/field/grid'
import type { ResolvedMedium } from '../physics/media/media'
import { applyKernel } from '../physics/propagation/angularSpectrum'
import type { CompiledSystem, RouteObserver } from '../physics/system'

/**
 * What to record during the LAST cycle of a step batch. Observation reads the field; it never changes it, so any
 * observation request yields exactly the same simulation result as none.
 */
export interface ObservationRequest {
  captureField?: boolean
  /** projections onto x at `samplesPerSegment` depths inside every propagation step, plus after every step */
  sideView?: { samplesPerSegment: number }
  /** full complex field after these route steps */
  stepFields?: number[]
  /** full complex field part-way through a propagation step */
  probe?: { stepIndex: number; fraction: number }
  taps?: boolean
  readouts?: boolean
}

/** Projection of a 2-D field onto x: mean_y |E|² (intensity) and mean_y E (coherent, carries phase). */
export interface Projection {
  I: Float32Array
  re: Float32Array
  im: Float32Array
}

export interface SideViewSegment {
  stepIndex: number
  /** rows[r] is the field at fraction r / rows.length through the segment (r = 0 is its entrance) */
  rows: Projection[]
}

export interface SideView {
  nx: number
  segments: SideViewSegment[]
  after: Record<number, Projection> // projection right after each route step
}

function emptyProjection(nx: number): Projection {
  return { I: new Float32Array(nx), re: new Float32Array(nx), im: new Float32Array(nx) }
}

export function projectSpatial(f: Field): Projection {
  const { nx, ny } = f.grid
  const p = emptyProjection(nx)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      p.I[i] += (f.re[k] ** 2 + f.im[k] ** 2) / ny
      p.re[i] += f.re[k] / ny
      p.im[i] += f.im[k] / ny
    }
  return p
}

/**
 * Projection of the field whose angular spectrum is S·H, without a full inverse 2-D FFT: one inverse 1-D FFT per ky
 * row gives G(x, ky); by Parseval along y, mean_y|E|² = Σ_ky |G|² / ny² and mean_y E = G(x, ky = 0) / ny.
 */
function projectSpectrum(spec: Field, H: { re: Float64Array; im: Float64Array }): Projection {
  const { nx, ny } = spec.grid
  const p = emptyProjection(nx)
  const tr = new Float64Array(nx), ti = new Float64Array(nx)
  for (let j = 0; j < ny; j++) {
    const o = j * nx
    for (let i = 0; i < nx; i++) {
      const a = spec.re[o + i], b = spec.im[o + i], hr = H.re[o + i], hi = H.im[o + i]
      tr[i] = a * hr - b * hi
      ti[i] = a * hi + b * hr
    }
    fft1(tr, ti, true)
    for (let i = 0; i < nx; i++) p.I[i] += (tr[i] * tr[i] + ti[i] * ti[i]) / (ny * ny)
    if (j === 0) for (let i = 0; i < nx; i++) { p.re[i] = tr[i] / ny; p.im[i] = ti[i] / ny }
  }
  return p
}

export class RouteRecorder implements RouteObserver {
  sideView?: SideView
  stepFields: Record<number, Float32Array> = {}
  probe?: Float32Array

  constructor(private system: CompiledSystem, private req: ObservationRequest) {
    if (req.sideView) this.sideView = { nx: system.grid.nx, segments: [], after: {} }
  }

  afterStep(index: number, field: Field): void {
    if (this.sideView) this.sideView.after[index] = projectSpatial(field)
    if (this.req.stepFields?.includes(index)) this.stepFields[index] = packField(field)
  }

  propagation(index: number, spectrum: Field, length: number, medium: ResolvedMedium): void {
    const { grid, wavelength, kernels } = this.system
    if (this.sideView) {
      const n = Math.max(1, this.req.sideView!.samplesPerSegment)
      const rows: Projection[] = []
      for (let r = 0; r < n; r++) rows.push(projectSpectrum(spectrum, kernels.get(grid, wavelength, (length * r) / n, medium)))
      this.sideView.segments.push({ stepIndex: index, rows })
    }
    const probe = this.req.probe
    if (probe && probe.stepIndex === index) {
      const f = createField(grid)
      applyKernel(spectrum, kernels.get(grid, wavelength, length * Math.min(1, Math.max(0, probe.fraction)), medium), f)
      fft2(f, true)
      this.probe = packField(f)
    }
  }
}
