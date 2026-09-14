import { useEffect, useRef } from 'react'
import type { RGB } from '../color/spectrum'

/** Log-scale trace over a fixed window so it scrolls instead of stretching. */
export function Sparkline({ values, window = 200, width = 240, height = 40 }: { values: ArrayLike<number>; window?: number; width?: number; height?: number }) {
  const n = values.length
  if (n < 2) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} />
  const logs = Array.from(values, (v) => Math.log10(Math.max(Math.abs(v), 1e-12)))
  const lo = Math.min(...logs)
  const hi = Math.max(...logs, lo + 0.5)
  const span = Math.max(window, n)
  const x = (i: number) => width - ((n - 1 - i) / (span - 1)) * width
  const y = (l: number) => 3 + (1 - (l - lo) / (hi - lo)) * (height - 6)
  const d = logs.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(l).toFixed(1)}`).join('')
  return (
    <svg className="spark" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="#fff" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Linear-scale series (e.g. σ(t), correlation(t)); optional horizontal threshold line. */
export function LinePlot({ series, width = 240, height = 70, threshold, yMin, yMax }: {
  series: { values: ArrayLike<number>; x?: ArrayLike<number>; dashed?: boolean }[]; width?: number; height?: number; threshold?: number; yMin?: number; yMax?: number
}) {
  const all = series.flatMap((s) => Array.from(s.values)).filter(Number.isFinite)
  if (!all.length) return <svg className="lineplot" viewBox={`0 0 ${width} ${height}`} />
  const lo = yMin ?? Math.min(...all)
  const hi = Math.max(yMax ?? Math.max(...all), lo + 1e-12)
  const xsAll = series.flatMap((s) => (s.x ? Array.from(s.x) : Array.from(s.values, (_, i) => i)))
  const xlo = Math.min(...xsAll), xhi = Math.max(...xsAll, xlo + 1)
  const px = (v: number) => ((v - xlo) / (xhi - xlo)) * width
  const py = (v: number) => height - 3 - ((v - lo) / (hi - lo)) * (height - 6)
  return (
    <svg className="lineplot" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {threshold !== undefined && <line x1={0} x2={width} y1={py(threshold)} y2={py(threshold)} className="threshold" vectorEffect="non-scaling-stroke" />}
      {series.map((s, k) => (
        <path key={k} fill="none" stroke="#fff" strokeWidth={1.2} strokeDasharray={s.dashed ? '3 2' : undefined} vectorEffect="non-scaling-stroke"
          d={Array.from(s.values, (v, i) => `${i ? 'L' : 'M'}${px(s.x ? s.x[i] : i).toFixed(1)},${py(v).toFixed(1)}`).join('')} />
      ))}
    </svg>
  )
}

/** Rows over time (newest at the bottom), each row normalised to its own maximum. */
export function Kymograph({ rows, bins, history = 160, height = 80, tint }: { rows: ArrayLike<number>[]; bins: number; history?: number; height?: number; tint?: RGB }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(bins, history)
    const recent = rows.slice(-history)
    const start = history - recent.length
    const [tr, tg, tb] = tint ? [tint[0] * 255, tint[1] * 255, tint[2] * 255] : [255, 255, 255]
    recent.forEach((row, r) => {
      let mx = 0
      for (let i = 0; i < bins; i++) mx = Math.max(mx, row[i])
      for (let i = 0; i < bins; i++) {
        const p = ((start + r) * bins + i) * 4
        const v = mx > 0 ? Math.sqrt(row[i] / mx) : 0
        img.data[p] = tr * v; img.data[p + 1] = tg * v; img.data[p + 2] = tb * v
        img.data[p + 3] = 255
      }
    })
    ctx.putImageData(img, 0, 0)
  }, [rows, bins, history, tint])
  return <canvas ref={ref} className="kymo" width={bins} height={history} style={{ height }} />
}
