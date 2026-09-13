import { N, P_SAT, OVERSAMPLE, type Params } from './params'
import {
  applyMask2, cloneField2, fft2, focalPlane2, inputField2, makeAbsorber, mulSpec, mulberry32,
  newField2, pack, power2, programMask2, projectSpatial, projectX, scale2, transfer2,
  type Field2, type Mask2,
} from './field2d'

/** Side view of one pass: the 2-D wavefront projected onto x on every row (z-ordered). */
export interface PassRec {
  rows: number
  I: Float32Array // rows × N, mean over y of |E|²
  cre: Float32Array // rows × N, mean over y of E (phase for the carrier animation)
  cim: Float32Array
  cen: Float32Array // intensity centroid per row, 0..1
  wid: Float32Array // rms width per row, 0..1
  maxI: number
}

export interface ProbeSpec {
  lane: 'down' | 'up'
  row: number
}

export interface TripRec {
  t: number
  injected: boolean
  down: PassRec
  up: PassRec
  /** full 2-D complex wavefronts (interleaved re/im, N²): x, h0, p0…p{n-1}, ret, readout, out, probe */
  images: Record<string, Float32Array>
  ccd: Float32Array // focal-plane intensity, N²
  ccdHistory: Float32Array // HISTORY × N, projection of each trip's CCD frame, oldest first
  ccdCount: number
  energyHistory: number[]
  energy: number
  gainEff: number
  lasing: boolean
  ms: number
}

export const HISTORY = 160
const ENERGY_CAP = 1e4

/** Mask programming is deterministic per seed, so the UI can rebuild the same masks for display. */
export function buildMasks(p: Params): { masks: Mask2[]; mOut: Mask2 } {
  const rand = mulberry32(p.seed)
  const masks = Array.from({ length: p.nLcd }, (_, i) => programMask2(p.program, p.depth, i, rand))
  return { masks, mOut: programMask2(p.program, p.depth, p.nLcd, rand) }
}

export function rowsFor(nLcd: number) {
  const S = Math.max(3, Math.floor(96 / (nLcd + 1)))
  return { S, rows: (nLcd + 1) * S + 1 }
}

export class Cavity {
  readonly p: Params
  readonly S: number
  readonly rows: number
  private H: Field2[] // H[s]: propagation by s/S of a gap
  private masks: Mask2[]
  private mOut: Mask2
  private x: Field2
  private E = newField2()
  private specDown: Field2[]
  private specUp: Field2[]
  private absorber = makeAbsorber()
  private energyHistory: number[] = []
  private ccdHistory: Float32Array[] = []
  t = 0

  constructor(p: Params, inputAmp: Float32Array) {
    this.p = { ...p }
    ;({ S: this.S, rows: this.rows } = rowsFor(p.nLcd))
    const dx = (p.pitchUm * 1e-6) / OVERSAMPLE
    this.H = Array.from({ length: this.S + 1 }, (_, s) => transfer2(dx, p.lambdaNm * 1e-9, (p.dSepMm * 1e-3 * s) / this.S))
    ;({ masks: this.masks, mOut: this.mOut } = buildMasks(p))
    this.x = inputField2(inputAmp)
    this.specDown = Array.from({ length: p.nLcd + 1 }, newField2)
    this.specUp = Array.from({ length: p.nLcd + 1 }, newField2)
  }

  setLive(p: Params) {
    Object.assign(this.p, {
      injection: p.injection, rIn: p.rIn, rOut: p.rOut, tLcd: p.tLcd, gain: p.gain,
      saturable: p.saturable, kerr: p.kerr, vacuum: p.vacuum, walls: p.walls,
    })
  }

  private newPass(): PassRec {
    const n = this.rows * N
    return {
      rows: this.rows, I: new Float32Array(n), cre: new Float32Array(n), cim: new Float32Array(n),
      cen: new Float32Array(this.rows), wid: new Float32Array(this.rows), maxI: 0,
    }
  }

  private stats(pass: PassRec, r: number) {
    const off = r * N
    let s = 0, sx = 0, sxx = 0
    for (let i = 0; i < N; i++) {
      const I = pass.I[off + i]
      const u = (i + 0.5) / N
      s += I; sx += u * I; sxx += u * u * I
      if (I > pass.maxI) pass.maxI = I
    }
    const c = s > 0 ? sx / s : 0.5
    pass.cen[r] = c
    pass.wid[r] = s > 0 ? Math.sqrt(Math.max(0, sxx / s - c * c)) : 0
  }

  private copyInto(dst: Field2, src: Field2) {
    dst.re.set(src.re)
    dst.im.set(src.im)
  }

  /** Propagate one gap: F = FT(E); project every sub-row; leave E at the far end. */
  private gap(pass: PassRec, spec: Field2, rowAt: (s: number) => number, air: number) {
    const E = this.E
    this.copyInto(spec, E)
    fft2(spec)
    for (let s = 1; s < this.S; s++) {
      const r = rowAt(s)
      projectX(spec, this.H[s], pass.I, pass.cre, pass.cim, r * N)
      this.stats(pass, r)
    }
    mulSpec(spec, this.H[this.S], E)
    fft2(E, true)
    scale2(E, air)
  }

  private project(pass: PassRec, r: number) {
    projectSpatial(this.E, pass.I, pass.cre, pass.cim, r * N)
    this.stats(pass, r)
  }

  step(probe: ProbeSpec | null): TripRec {
    const t0 = performance.now()
    const p = this.p
    const n = p.nLcd
    const S = this.S
    const E = this.E
    const air = p.vacuum ? 1 : Math.sqrt(Math.pow(0.998, p.dSepMm * 1e-3))
    const lcdAmp = Math.sqrt(p.tLcd)
    const absorber = p.walls === 'absorb' ? this.absorber : null
    const images: Record<string, Float32Array> = {}

    // input coupler: h = √R · (returning state) + √(1−R) · M_in x
    const injected = p.injection === 'continuous' || this.t === 0
    scale2(E, Math.sqrt(p.rIn))
    if (injected) {
      const a = Math.sqrt(1 - p.rIn)
      for (let i = 0; i < E.re.length; i++) E.re[i] += a * this.x.re[i]
    }
    images.x = pack(this.x)
    images.h0 = pack(E)

    // ↓ pass
    const down = this.newPass()
    this.project(down, 0)
    for (let g = 0; g <= n; g++) {
      this.gap(down, this.specDown[g], (s) => g * S + s, air)
      if (g < n) {
        applyMask2(E, this.masks[g], absorber, lcdAmp)
        images['p' + g] = pack(E)
      }
      this.project(down, (g + 1) * S)
    }

    // readout coupler transmits a sample; the gain film sits just above it
    const readout = cloneField2(E)
    scale2(readout, Math.sqrt(1 - p.rOut))
    images.readout = pack(readout)
    scale2(E, Math.sqrt(p.rOut))
    const gainEff = p.saturable ? 1 + (p.gain - 1) / (1 + power2(E) / P_SAT) : p.gain
    scale2(E, Math.sqrt(gainEff))
    if (p.kerr > 0) {
      // Kerr-type self-phase: bright regions pick up extra phase — an intensity-dependent, nonlinear term
      for (let i = 0; i < E.re.length; i++) {
        const ph = (p.kerr * (E.re[i] ** 2 + E.im[i] ** 2)) / P_SAT
        const c = Math.cos(ph), s = Math.sin(ph)
        const r = E.re[i] * c - E.im[i] * s
        E.im[i] = E.re[i] * s + E.im[i] * c
        E.re[i] = r
      }
    }

    // ↑ pass, masks in reverse
    const up = this.newPass()
    this.project(up, this.rows - 1)
    for (let g = n; g >= 0; g--) {
      this.gap(up, this.specUp[g], (s) => g * S + (S - s), air)
      if (g > 0) applyMask2(E, this.masks[g - 1], absorber, lcdAmp)
      this.project(up, g * S)
    }
    images.ret = pack(E)

    let energy = power2(E)
    let lasing = false
    if (energy > ENERGY_CAP) {
      scale2(E, Math.sqrt(ENERGY_CAP / energy))
      energy = ENERGY_CAP
      lasing = true
    }

    // M_out → lens → CCD
    const out = cloneField2(readout)
    applyMask2(out, this.mOut, absorber, 1)
    images.out = pack(out)
    const ccd = focalPlane2(out)
    const proj = new Float32Array(N)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) proj[x] += ccd[y * N + x] / N

    this.energyHistory.push(energy)
    this.ccdHistory.push(proj)
    if (this.energyHistory.length > HISTORY) this.energyHistory.shift()
    if (this.ccdHistory.length > HISTORY) this.ccdHistory.shift()
    const hist = new Float32Array(HISTORY * N)
    this.ccdHistory.forEach((row, i) => hist.set(row, i * N))

    if (probe) images.probe = this.probeImage(probe)

    const rec: TripRec = {
      t: this.t, injected, down, up, images, ccd, ccdHistory: hist, ccdCount: this.ccdHistory.length,
      energyHistory: this.energyHistory.slice(), energy, gainEff, lasing, ms: performance.now() - t0,
    }
    this.t++
    return rec
  }

  /** Full 2-D wavefront at any row of the last trip, rebuilt from the stored gap spectra. */
  probeImage({ lane, row }: ProbeSpec): Float32Array {
    const S = this.S
    const n = this.p.nLcd
    let spec: Field2
    let s: number
    if (lane === 'down') {
      const g = Math.min(n, Math.floor(row / S))
      s = row - g * S
      spec = this.specDown[g]
    } else {
      const g = row === 0 ? 0 : Math.ceil(row / S) - 1
      s = (g + 1) * S - row
      spec = this.specUp[g]
    }
    const f = newField2()
    mulSpec(spec, this.H[s], f)
    fft2(f, true)
    return pack(f)
  }
}
