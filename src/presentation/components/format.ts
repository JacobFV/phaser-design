const PREFIX: [number, string][] = [[1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']]
const PREFIXABLE = new Set(['m', 's', 'Hz', 'rad'])

/** Human-readable value: SI prefixes for physical units, scientific notation for large dimensionless counts. */
export function formatValue(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  if (PREFIXABLE.has(unit) && value !== 0) {
    const a = Math.abs(value)
    const [f, p] = PREFIX.find(([f]) => a >= f * 0.9995) ?? PREFIX[PREFIX.length - 1]
    return `${Number((value / f).toPrecision(3))} ${p}${unit}`
  }
  const a = Math.abs(value)
  const num = a !== 0 && (a >= 1e5 || a < 1e-3) ? superscript(value.toExponential(2)) : String(Number(value.toPrecision(4)))
  return unit ? `${num} ${unit}` : num
}

function superscript(exp: string): string {
  const [m, e] = exp.split('e')
  const digits = String(Number(e)).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
  return `${m}×10${digits}`
}
