/** Project a packed complex field onto x: mean_y |E|² and arg(mean_y E). */
export function projectPacked(data: ArrayLike<number>, nx: number, ny: number): { I: Float32Array; phase: Float32Array } {
  const I = new Float32Array(nx)
  const re = new Float32Array(nx)
  const im = new Float32Array(nx)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = 2 * (j * nx + i)
      I[i] += (data[k] ** 2 + data[k + 1] ** 2) / ny
      re[i] += data[k] / ny
      im[i] += data[k + 1] / ny
    }
  return { I, phase: re.map((r, i) => Math.atan2(im[i], r)) }
}

/** 1-D projection: intensity as a filled area, phase as a dotted trace where there is light. */
export function Waveform({ intensity: I, phase, width = 180, height = 48, xLabel }: { intensity: ArrayLike<number>; phase?: ArrayLike<number>; width?: number; height?: number; xLabel?: string }) {
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
    let pen = false, prev = 0
    for (let i = 0; i < n; i++) {
      if (I[i] < max * 0.02) { pen = false; continue }
      const y = base - ((phase[i] + Math.PI) / (2 * Math.PI)) * plotH
      const wrap = pen && Math.abs(phase[i] - prev) > Math.PI
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
