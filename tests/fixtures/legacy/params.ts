export type InputPattern = 'smiley' | 'text' | 'token' | 'gaussian' | 'uniform' | 'slits' | 'bits'
export type MaskProgram = 'random' | 'grating' | 'lenslets' | 'off'
export type Injection = 'pulse' | 'continuous'
export type Walls = 'periodic' | 'absorb'

export interface Params {
  // structural (changing these rebuilds the cavity and restarts at t = 0)
  nLcd: number // number of M_step planes
  dSepMm: number // plane separation, mm
  lambdaNm: number // wavelength, nm
  pitchUm: number // LCD pixel pitch D, µm
  program: MaskProgram
  depth: number // phase modulation depth, 0..1 of 2π
  seed: number
  input: InputPattern
  text: string
  token: number
  // live (applied on the next round trip)
  injection: Injection
  rIn: number // input coupler reflectivity
  rOut: number // readout coupler reflectivity
  tLcd: number // per-pass LCD transmission
  gain: number // small-signal intensity gain per round trip (gain film)
  saturable: boolean
  kerr: number // peak nonlinear (intensity-dependent) phase in the gain film, rad at P_sat
  vacuum: boolean
  walls: Walls // side walls of the chamber
}

export const DEFAULT_PARAMS: Params = {
  nLcd: 4,
  dSepMm: 10,
  lambdaNm: 650,
  pitchUm: 63.5,
  program: 'random',
  depth: 0.08,
  seed: 7,
  input: 'smiley',
  text: 'PHASER',
  token: 3,
  injection: 'pulse',
  rIn: 0.9,
  rOut: 0.9,
  tLcd: 0.98,
  gain: 1.6,
  saturable: true,
  kerr: 0,
  vacuum: false,
  walls: 'periodic',
}

export const STRUCTURAL: (keyof Params)[] = [
  'nLcd', 'dSepMm', 'lambdaNm', 'pitchUm', 'program', 'depth', 'seed', 'input', 'text', 'token',
]

// Simulated transverse grid: LCD_PIXELS × LCD_PIXELS modulator pixels, OVERSAMPLE² samples each.
export const LCD_PIXELS = 64
export const OVERSAMPLE = 2
export const N = LCD_PIXELS * OVERSAMPLE // 128, power of two
export const N_TOKENS = 8
export const P_SAT = 0.5
