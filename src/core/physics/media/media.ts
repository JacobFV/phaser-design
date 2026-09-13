/**
 * Propagation media. Each kind carries only the parameters that make sense for it; everything is
 * resolved to (n, n_g, α) at the operating wavelength. α is the POWER attenuation coefficient:
 * P(L) = P(0)·e^{−αL}.
 *
 * Deliberately small: a few physically grounded models plus arbitrary custom values, not a spectroscopy database.
 */
export type GasId = 'nitrogen' | 'helium' | 'argon' | 'carbon-dioxide' | 'hydrogen'

export interface VacuumMedium { kind: 'vacuum' }
export interface AirMedium {
  kind: 'air'
  pressurePa: number
  temperatureK: number
  attenuationPerM: number // power attenuation (scattering/absorption), 1/m
}
export interface GasMedium {
  kind: 'gas'
  gas: GasId
  pressurePa: number
  temperatureK: number
  attenuationPerM: number
}
export interface CustomMedium {
  kind: 'custom'
  label?: string
  refractiveIndex: number
  groupIndex?: number // defaults to refractiveIndex (dispersion ignored)
  attenuationPerM: number
  gvdFs2PerMm?: number // group-velocity dispersion; recorded for future pulse models, unused by the CW solver
}

export type MediumSpec = VacuumMedium | AirMedium | GasMedium | CustomMedium

export interface ResolvedMedium {
  n: number // phase index
  ng: number // group index (sets transit time)
  alpha: number // power attenuation, 1/m
  label: string
}

const P0 = 101_325
const T15 = 288.15
const T0 = 273.15

/** Edlén (1966) dispersion of standard dry air (15 °C, 101.325 kPa); λ in metres. */
function airRefractivityStd(lambda: number): number {
  const s2 = (1 / (lambda * 1e6)) ** 2
  return (8342.54 + 2406147 / (130 - s2) + 15998 / (38.9 - s2)) * 1e-8
}

/** Refractivity (n−1) at 0 °C, 1 atm near 633 nm, and a simple Cauchy slope for group index. */
const GAS_TABLE: Record<GasId, { refractivity: number; label: string }> = {
  nitrogen: { refractivity: 2.98e-4, label: 'N₂' },
  helium: { refractivity: 3.5e-5, label: 'He' },
  argon: { refractivity: 2.81e-4, label: 'Ar' },
  'carbon-dioxide': { refractivity: 4.49e-4, label: 'CO₂' },
  hydrogen: { refractivity: 1.39e-4, label: 'H₂' },
}

export const GAS_IDS = Object.keys(GAS_TABLE) as GasId[]

export function resolveMedium(spec: MediumSpec, lambda: number): ResolvedMedium {
  switch (spec.kind) {
    case 'vacuum':
      return { n: 1, ng: 1, alpha: 0, label: 'vacuum' }
    case 'air': {
      const density = (spec.pressurePa / P0) * (T15 / spec.temperatureK)
      const nAt = (l: number) => 1 + airRefractivityStd(l) * density
      const n = nAt(lambda)
      const h = lambda * 1e-3
      const dndl = (nAt(lambda + h) - nAt(lambda - h)) / (2 * h)
      return { n, ng: n - lambda * dndl, alpha: spec.attenuationPerM, label: `air ${(spec.pressurePa / 1000).toFixed(1)} kPa` }
    }
    case 'gas': {
      const g = GAS_TABLE[spec.gas]
      const n = 1 + g.refractivity * (spec.pressurePa / P0) * (T0 / spec.temperatureK)
      // group index ≈ phase index: gas dispersion is ~1% of refractivity in the visible
      return { n, ng: n, alpha: spec.attenuationPerM, label: `${g.label} ${(spec.pressurePa / 1000).toFixed(1)} kPa` }
    }
    case 'custom':
      return {
        n: spec.refractiveIndex,
        ng: spec.groupIndex ?? spec.refractiveIndex,
        alpha: spec.attenuationPerM,
        label: spec.label ?? `n = ${spec.refractiveIndex}`,
      }
  }
}

export const MEDIUM_PRESETS: Record<string, MediumSpec> = {
  vacuum: { kind: 'vacuum' },
  'air (15 °C, 1 atm)': { kind: 'air', pressurePa: P0, temperatureK: T15, attenuationPerM: -Math.log(0.998) },
  'rough vacuum (10 Pa air)': { kind: 'air', pressurePa: 10, temperatureK: 293.15, attenuationPerM: 0 },
  'helium (1 atm)': { kind: 'gas', gas: 'helium', pressurePa: P0, temperatureK: 293.15, attenuationPerM: 0 },
  'nitrogen (1 atm)': { kind: 'gas', gas: 'nitrogen', pressurePa: P0, temperatureK: 293.15, attenuationPerM: 0 },
}
