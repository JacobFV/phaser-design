import type { MediumSpec } from '../media/media'

/**
 * Optical element specifications — plain, JSON-serialisable data.
 *
 * Direction: every element is entered from one of two faces. A route step names the face explicitly, and every
 * property that can differ between faces is a `Directional<T>`. Nothing assumes a reverse pass behaves like the
 * forward pass.
 *
 * All transmission / reflectivity / retained values are POWER fractions.
 */
export type IncidentSide = 'front' | 'back'

export interface Directional<T> {
  front: T
  back: T
}

export const bothSides = <T>(v: T): Directional<T> => ({ front: v, back: v })

export interface Vec2 {
  x: number
  y: number
}

/** Reference to a large externally supplied array (e.g. a phase mask), addressed by id and pinned by content hash. */
export interface AssetRef {
  id: string
  width: number
  height: number
  hash: string
}

/**
 * A mask/control program: commanded values per device pixel, row-major.
 * Phase devices interpret values as commanded phase (rad). Amplitude devices interpret value/2π as drive level ∈ [0, 1).
 * Procedural generators are presets; `array` is the general programming interface.
 */
export type MaskProgram =
  | { kind: 'zero' }
  | { kind: 'random'; seed: number; depth: number }
  | { kind: 'grating'; periodPx: number; depth: number; orientation: 'x' | 'y' | 'diagonal' | 'antidiagonal' }
  | { kind: 'lenslets'; groupPx: number; depth: number }
  | { kind: 'array'; ref: AssetRef }

/** Maps normalised drive u ∈ [0, 1] to normalised achieved response. */
export type PhaseResponse =
  | { kind: 'linear' }
  | { kind: 'gamma'; gamma: number }
  | { kind: 'lut'; table: number[] } // uniformly sampled over u ∈ [0, 1], linearly interpolated

export interface PixelArray {
  resolution: { x: number; y: number }
  pitch: Vec2 // m
  fillFactor: number // active AREA fraction of each pixel cell
  offset: Vec2 // centre of the panel relative to the optical axis, m
}

interface Base {
  id: string
  label?: string
}

export interface MirrorSpec extends Base {
  kind: 'mirror'
  reflectivity: Directional<number>
  /** image parity of the reflection in the transverse frame of the route */
  parity: 'none' | 'flip-x' | 'flip-y'
}

/** Partially reflective coupler. The retained (reflected, in-cavity) part continues along the route. */
export interface CouplerSpec extends Base {
  kind: 'coupler'
  retained: Directional<number>
  /** records the out-coupled field √(1 − retained) into this tap before continuing */
  outputTap?: string
  /** injects queued input on the front face with power coupling `inputCoupling` (default 1 − retained.front) */
  inputPort?: string
  inputCoupling?: number
}

export interface ThinLensSpec extends Base {
  kind: 'lens'
  focalLength: number
  apertureDiameter: number
  transmission: Directional<number>
}

export interface MicrolensArraySpec extends Base {
  kind: 'microlens-array'
  pitch: Vec2
  focalLength: number
  apertureDiameter: number // clear circular aperture of each lenslet
  fillFactor: number // fraction of each lattice cell covered by the lens footprint; outside is opaque
  transmission: Directional<number>
  offset: Vec2 // lattice offset relative to the optical axis (e.g. misalignment to LCD pixels)
  rotationRad: number
  focalLengthSigma: number // fractional 1σ lenslet-to-lenslet focal-length error (0 = ideal)
  seed: number
}

export interface ApertureSpec extends Base {
  kind: 'aperture'
  shape: 'rect' | 'circle'
  size: Vec2 // full width/height (circle uses size.x as diameter)
  softEdge: number // cosine roll-off width, m
}

export interface LcosSlmSpec extends Base {
  kind: 'lcos-slm'
  pixels: PixelArray
  reflectivity: number // front-face reflectivity of active pixels; the back face is opaque silicon
  deadZoneReflectivity: number
  phaseRange: number // usable phase stroke, rad
  phaseLevels: number // quantisation levels (0 = analogue)
  phaseResponse: PhaseResponse
  switchingTime: number // s
  designWavelength: number // m; phase scales as λ_design/λ off design
  program: MaskProgram
  aberration?: MaskProgram // static phase error map added to every program
}

export interface LcdSurface {
  transmission: number
  reflection: number // reflected power is treated as lost from the route (ghosts not recirculated)
}

export type LcdModulation =
  | { kind: 'phase'; phaseRange: number; levels: number; response: PhaseResponse }
  | { kind: 'amplitude'; darkTransmission: number; levels: number }

export interface TransmissiveLcdSpec extends Base {
  kind: 'transmissive-lcd'
  pixels: PixelArray
  modulation: LcdModulation
  clearTransmission: number // active-pixel transmission of the LC cell itself
  surfaces: Directional<LcdSurface> // entrance-face coating/window, per incidence side
  polarizerTransmission: number // explicit polarisation-related loss per pass (1 = ideal phase-only operation)
  deadZoneTransmission: number // black matrix between pixels
  switchingTime: number
  designWavelength: number
  program: MaskProgram
}

type Inner<T> = Omit<T, 'kind' | 'id' | 'label'>

/** LCD with a microlens array bonded behind it. Front: LCD → gap → MLA. Back: MLA → gap → LCD. */
export interface LcdMicrolensSpec extends Base {
  kind: 'lcd-microlens'
  lcd: Inner<TransmissiveLcdSpec>
  microlens: Inner<MicrolensArraySpec>
  spacing: number
  spacingMedium: MediumSpec
}

/** Fixed diffractive / phase plate (e.g. a cheap optical mixer between programmable planes). */
export interface PhasePlateSpec extends Base {
  kind: 'phase-plate'
  pixels: PixelArray
  transmission: Directional<number>
  designWavelength: number
  program: MaskProgram
}

export type GainSaturation =
  | { kind: 'none' }
  | { kind: 'global'; saturationIntensity: number } // homogeneous medium saturating on mean intensity
  | { kind: 'local'; saturationIntensity: number } // saturates sample-by-sample

export type GainNoise =
  | { kind: 'none' }
  | { kind: 'additive-gaussian'; meanIntensity: number; seed: number } // spontaneous-emission-like additive field

export interface GainSpec extends Base {
  kind: 'gain'
  smallSignalGain: number // power gain per pass
  saturation: GainSaturation
  noise: GainNoise
}

/** Local response E' = g(|E|²)·exp(iφ(|E|²))·E. */
export type IntensityResponse =
  | { kind: 'none' }
  | { kind: 'saturable'; strength: number; saturationIntensity: number } // power gain 1 + s/(1 + I/I_sat); s < 0 absorbs
  | { kind: 'kerr'; coefficient: number } // φ = c·I
  | { kind: 'saturable-kerr'; maxPhase: number; saturationIntensity: number } // φ = φ_max·I/(I + I_sat)

export interface NonlinearSpec extends Base {
  kind: 'nonlinear'
  amplitude: IntensityResponse
  phase: IntensityResponse
}

export type OpticalElementSpec =
  | MirrorSpec
  | CouplerSpec
  | ThinLensSpec
  | MicrolensArraySpec
  | ApertureSpec
  | LcosSlmSpec
  | TransmissiveLcdSpec
  | LcdMicrolensSpec
  | PhasePlateSpec
  | GainSpec
  | NonlinearSpec

export type ElementKind = OpticalElementSpec['kind']

export type ProgrammableElementSpec = LcosSlmSpec | TransmissiveLcdSpec | LcdMicrolensSpec | PhasePlateSpec

export const isProgrammable = (s: OpticalElementSpec): s is ProgrammableElementSpec =>
  s.kind === 'lcos-slm' || s.kind === 'transmissive-lcd' || s.kind === 'lcd-microlens' || s.kind === 'phase-plate'

export function programOf(s: ProgrammableElementSpec): MaskProgram {
  return s.kind === 'lcd-microlens' ? s.lcd.program : s.program
}

export function withProgram<T extends ProgrammableElementSpec>(s: T, program: MaskProgram): T {
  return s.kind === 'lcd-microlens' ? { ...s, lcd: { ...s.lcd, program } } : { ...s, program }
}
