import { useEffect, useRef } from 'react'
import { HISTORY } from '../physics/cavity'

/** Circulating power per round trip (log scale), scrolling over a fixed window. */
export function Sparkline({ values, width = 240, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} />
  const logs = values.map((v) => Math.log10(Math.max(v, 1e-9)))
  const lo = Math.min(...logs)
  const hi = Math.max(...logs, lo + 0.5)
  const x = (i: number) => width - ((values.length - 1 - i) / (HISTORY - 1)) * width
  const y = (l: number) => 3 + (1 - (l - lo) / (hi - lo)) * (height - 6)
  const d = logs.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(l).toFixed(1)}`).join('')
  return (
    <svg className="spark" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="#fff" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(logs[logs.length - 1])} r={2.2} fill="#fff" />
    </svg>
  )
}

/** Detector readout over time: one row per round trip (projected onto x), newest at the bottom. */
export function Kymograph({ rows, count, bins, height = 80 }: { rows: Float32Array; count: number; bins: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(bins, HISTORY)
    const start = HISTORY - count
    for (let r = 0; r < count; r++) {
      let mx = 0
      for (let i = 0; i < bins; i++) mx = Math.max(mx, rows[r * bins + i])
      for (let i = 0; i < bins; i++) {
        const v = mx > 0 ? 255 * Math.sqrt(rows[r * bins + i] / mx) : 0 // per-row normalisation: pattern, not brightness
        const p = ((start + r) * bins + i) * 4
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v
        img.data[p + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [rows, count, bins])
  return <canvas ref={ref} className="kymo" width={bins} height={HISTORY} style={{ height }} />
}
