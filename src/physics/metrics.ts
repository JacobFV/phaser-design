import type { Params } from './params'

const C = 3e8
const N_PIX_LCD = 1e6 // 1000 × 1000 pixels per physical LCD, as in the post

/** The post's first-principles throughput + loss budget, evaluated for the current parameters. */
export function metrics(p: Params) {
  const dSep = p.dSepMm * 1e-3
  const L = p.nLcd * dSep
  const stepsPerSec = C / L
  const opsNaive = p.nLcd * N_PIX_LCD * N_PIX_LCD
  const D = p.pitchUm * 1e-6
  const theta = (1.22 * p.lambdaNm * 1e-9) / D
  const area = Math.PI * (dSep * Math.tan(theta)) ** 2
  const rho = 1 / D
  const nEff = area * rho * rho
  const opsLocal = p.nLcd * N_PIX_LCD * nEff
  const airRT = p.vacuum ? 1 : Math.pow(0.998, 2 * (p.nLcd + 1) * dSep)
  const passive = p.rIn * p.rOut * Math.pow(p.tLcd, 2 * p.nLcd) * airRT
  return {
    L,
    stepsPerSec,
    opsNaive,
    naive: opsNaive * stepsPerSec,
    theta,
    area,
    rho,
    nEff,
    spreadPx: (dSep * Math.tan(theta)) / D, // lateral spread per gap, in LCD pixels
    opsLocal,
    local: opsLocal * stepsPerSec,
    airRT,
    passive, // round-trip intensity retention without gain
    loopGain: passive * p.gain, // small-signal
    retained1000: Math.pow(passive, 1000),
  }
}

export function sci(x: number, digits = 2): string {
  if (!isFinite(x)) return '∞'
  if (x === 0) return '0'
  const e = Math.floor(Math.log10(Math.abs(x)))
  if (e >= -2 && e < 4) return x.toPrecision(digits + 1).replace(/\.?0+$/, '')
  const m = x / 10 ** e
  const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])
  return `${m.toFixed(digits - 1)}×10${sup}`
}
