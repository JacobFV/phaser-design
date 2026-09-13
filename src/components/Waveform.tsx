import { N } from '../physics/params'

/** Project a packed 2-D wavefront onto x: mean_y |E|² (intensity) and arg(mean_y E) (phase). */
export function projectImage(img: Float32Array): { I: Float32Array; ph: Float32Array } {
  const I = new Float32Array(N)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const j = 2 * (y * N + x)
      I[x] += (img[j] ** 2 + img[j + 1] ** 2) / N
      re[x] += img[j] / N
      im[x] += img[j + 1] / N
    }
  const ph = new Float32Array(N)
  for (let x = 0; x < N; x++) ph[x] = Math.atan2(im[x], re[x])
  return { I, ph }
}

interface Props {
  intensity: ArrayLike<number>
  phase?: ArrayLike<number>
  width?: number
  height?: number
  xLabel?: string
}

/** 1-D projection of a slice: intensity as a filled area, phase as a dotted trace where there's light. */
export function Waveform({ intensity: I, phase, width = 268, height = 46, xLabel }: Props) {
  const n = I.length
  let max = 0
  for (let i = 0; i < n; i++) if (I[i] > max) max = I[i]
  const padT = 3
  const plotH = height - padT - (xLabel ? 11 : 2)
  const base = padT + plotH
  const xs = (i: number) => ((i + 0.5) / n) * width
  let area = `M0,${base}`
  for (let i = 0; i < n; i++) area += `L${xs(i).toFixed(1)},${(base - (max > 0 ? I[i] / max : 0) * plotH).toFixed(1)}`
  area += `L${width},${base}Z`

  let ph = ''
  if (phase && max > 0) {
    let pen = false
    let prev = 0
    for (let i = 0; i < n; i++) {
      if (I[i] < max * 0.02) { pen = false; continue }
      const y = base - ((phase[i] + Math.PI) / (2 * Math.PI)) * plotH
      const wrap = pen && Math.abs(phase[i] - prev) > Math.PI // lift the pen at 2π wraps
      ph += `${pen && !wrap ? 'L' : 'M'}${xs(i).toFixed(1)},${y.toFixed(1)}`
      pen = true
      prev = phase[i]
    }
  }

  return (
    <svg className="waveform" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <line x1={0} x2={width} y1={base} y2={base} className="wf-axis" />
      <path d={area} className="wf-area" vectorEffect="non-scaling-stroke" />
      {ph && <path d={ph} className="wf-phase" vectorEffect="non-scaling-stroke" />}
      {xLabel && <text x={width} y={height - 1} className="wf-label" textAnchor="end">{xLabel}</text>}
    </svg>
  )
}
