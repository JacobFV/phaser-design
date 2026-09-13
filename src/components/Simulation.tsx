import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { PassRec, ProbeSpec, TripRec } from '../physics/cavity'
import type { Mask2 } from '../physics/field2d'
import type { Geometry, Lane } from '../layout'
import { LCD_PIXELS, N, type Params } from '../physics/params'
import { metrics } from '../physics/metrics'
import { projectImage } from './Waveform'

interface Props {
  rec: TripRec | null
  prev: TripRec | null
  progress: number // 0..1 through the current round trip (↓ then ↑)
  g: Geometry
  params: Params
  masks: Mask2[]
  mOut: Mask2
  rows: number
  xAmp: Float32Array // LCD_PIXELS² input pattern
  probe: ProbeSpec | null
  onProbe: (p: ProbeSpec | null) => void
}

const SUPER = 2 // canvas pixels per viewBox unit
const LAMBDA_VIS = 16 // displayed wavelength in viewBox units (real 650 nm crests would be invisible)
const CREST_SPEED = 26 // viewBox units per second

// Static (carrier-free) bitmaps of a pass, used for the dimmed previous trip.
const staticCache = new WeakMap<PassRec, HTMLCanvasElement>()

function staticBitmap(pass: PassRec, norm: number) {
  const hit = staticCache.get(pass)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = N
  c.height = pass.rows
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, pass.rows)
  for (let i = 0; i < N * pass.rows; i++) {
    const v = norm > 0 ? 255 * Math.sqrt(pass.I[i] / norm) : 0
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  staticCache.set(pass, c)
  return c
}

/** Paint rows [r0, r1) of a pass with a travelling carrier: brightness ∝ |E| · cos²(±kz − ωt + φ). */
function carrierBitmap(buf: { canvas: HTMLCanvasElement; img: ImageData }, pass: PassRec, norm: number, g: Geometry, dir: 1 | -1, time: number) {
  const k = (2 * Math.PI) / LAMBDA_VIS
  const wt = k * CREST_SPEED * time
  const d = buf.img.data
  for (let r = 0; r < pass.rows; r++) {
    const kz = dir * k * g.rowY(r) - wt
    const off = r * N
    for (let x = 0; x < N; x++) {
      const i = off + x
      const a = norm > 0 ? Math.sqrt(pass.I[i] / norm) : 0
      const c = Math.cos(kz + Math.atan2(pass.cim[i], pass.cre[i]))
      const v = Math.min(255, 255 * a * (0.18 + 0.95 * c * c))
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
      d[i * 4 + 3] = 255
    }
  }
  buf.canvas.getContext('2d')!.putImageData(buf.img, 0, 0)
  return buf.canvas
}

function makeBuf(rows: number) {
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = rows
  return { canvas, img: canvas.getContext('2d')!.createImageData(N, rows) }
}

export function Simulation({ rec, prev, progress, g, params: p, masks, mOut, rows, xAmp, probe, onProbe }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverPlane, setHoverPlane] = useState<number | null>(null)
  const m = metrics(p)
  const pd = Math.min(1, progress * 2)
  const pu = Math.max(0, progress * 2 - 1)

  // the carrier animates continuously, so drawing runs on its own frame loop fed by refs
  const live = useRef({ rec, prev, pd, pu, g, rows, progress })
  live.current = { rec, prev, pd, pu, g, rows, progress }
  const bufs = useRef<{ rows: number; down: ReturnType<typeof makeBuf>; up: ReturnType<typeof makeBuf> } | null>(null)

  useEffect(() => {
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const ctx = canvasRef.current?.getContext('2d')
      const L = live.current
      if (!ctx) return
      const { g } = L
      if (!bufs.current || bufs.current.rows !== L.rows) bufs.current = { rows: L.rows, down: makeBuf(L.rows), up: makeBuf(L.rows) }
      const span = g.couplerOutY - g.couplerInY
      ctx.setTransform(SUPER, 0, 0, SUPER, 0, 0)
      ctx.clearRect(0, 0, g.vbW, g.vbH)
      ctx.imageSmoothingEnabled = true
      const blit = (src: HTMLCanvasElement, rowsN: number, lane: Lane, from: number, to: number, alpha: number) => {
        const r0 = from * (rowsN - 1)
        const r1 = to * (rowsN - 1)
        if (r1 - r0 <= 0) return
        ctx.globalAlpha = alpha
        ctx.drawImage(src, 0, r0, N, r1 - r0, lane.x, g.couplerInY + from * span, lane.w, (to - from) * span)
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = '#000'
      ctx.fillRect(g.down.x, g.couplerInY, g.down.w, span)
      ctx.fillRect(g.up.x, g.couplerInY, g.up.w, span)
      if (L.prev && L.prev.down.rows === L.rows) {
        const norm = Math.max(L.prev.down.maxI, L.prev.up.maxI)
        blit(staticBitmap(L.prev.down, norm), L.rows, g.down, L.pd, 1, 0.28)
        blit(staticBitmap(L.prev.up, norm), L.rows, g.up, 0, 1 - L.pu, 0.28)
      }
      const r = L.rec
      if (!r || r.down.rows !== L.rows) return
      const norm = Math.max(r.down.maxI, r.up.maxI)
      const time = now / 1000
      blit(carrierBitmap(bufs.current.down, r.down, norm, g, 1, time), L.rows, g.down, 0, L.pd, 1)
      blit(carrierBitmap(bufs.current.up, r.up, norm, g, -1, time), L.rows, g.up, 1 - L.pu, 1, 1)
      if (L.progress < 1) {
        const lane = L.progress < 0.5 ? g.down : g.up
        const y = g.couplerInY + (L.progress < 0.5 ? L.pd : 1 - L.pu) * span
        const grad = ctx.createLinearGradient(0, y - 12, 0, y + 12)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.9)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = grad
        ctx.fillRect(lane.x, y - 12, lane.w, 24)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toVB = (e: MouseEvent) =>
    new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse())
  const onMove = (e: MouseEvent) => {
    const { x, y } = toVB(e)
    let hp: number | null = null
    if (x > g.down.x && x < g.up.x + g.up.w)
      for (let k = 0; k < p.nLcd; k++) if (Math.abs(y - g.planeY(k)) < 7) hp = k
    setHoverPlane(hp)
  }
  const onClick = (e: MouseEvent) => {
    const { x, y } = toVB(e)
    const h = g.hit(x, y)
    if (h) onProbe(h)
  }

  // pass envelope "rays": centroid ± 2σ of the projected intensity on every row
  const envelope = (pass: PassRec, lane: Lane, sign: -1 | 1) => {
    let d = ''
    for (let r = 0; r < pass.rows; r++) {
      const u = Math.min(1, Math.max(0, pass.cen[r] + sign * 2 * pass.wid[r]))
      d += `${r ? 'L' : 'M'}${(lane.x + u * lane.w).toFixed(1)},${g.rowY(r).toFixed(1)}`
    }
    return d
  }

  const physW = LCD_PIXELS * p.pitchUm * 1e-6
  const coneHalf = ((p.dSepMm * 1e-3 * Math.tan(m.theta)) / physW) * g.down.w
  const gapPx = g.planeY(0) - g.couplerInY
  const midRow = (mask: Mask2) => Array.from(mask.subarray((LCD_PIXELS / 2) * LCD_PIXELS, (LCD_PIXELS / 2 + 1) * LCD_PIXELS))
  const xCols = columnMax(xAmp)
  const readout = rec ? projectImage(rec.images.readout).I : null
  const ccdRow = rec ? rec.ccdHistory.subarray((rec.ccdCount - 1) * N, rec.ccdCount * N) : null
  const lanes = rec && rec.down.rows === rows

  return (
    <div className="sim" style={{ aspectRatio: `${g.vbW} / ${g.vbH}` }}>
      <canvas ref={canvasRef} width={g.vbW * SUPER} height={g.vbH * SUPER} />
      <svg ref={svgRef} viewBox={`0 0 ${g.vbW} ${g.vbH}`} onMouseMove={onMove} onMouseLeave={() => setHoverPlane(null)} onClick={onClick}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0.8 L7,4 L0,7.2" fill="none" stroke="#fff" strokeWidth="1.3" />
          </marker>
          <clipPath id="clip-down">
            <rect x={g.down.x} y={g.couplerInY} width={g.down.w} height={pd * (g.couplerOutY - g.couplerInY)} />
          </clipPath>
          <clipPath id="clip-up">
            <rect x={g.up.x} y={g.couplerOutY - pu * (g.couplerOutY - g.couplerInY)} width={g.up.w} height={pu * (g.couplerOutY - g.couplerInY)} />
          </clipPath>
        </defs>

        {/* laser → M_in → input coupler */}
        <rect {...g.laser} rx={4} className="part" />
        <text x={g.laser.x + g.laser.w / 2} y={g.laser.y + 21} className="t-title" textAnchor="middle">laser</text>
        <text x={g.laser.x + g.laser.w / 2} y={g.laser.y + 37} className="t-small dim" textAnchor="middle">λ = {p.lambdaNm} nm</text>
        <line x1={g.down.cx} x2={g.down.cx} y1={g.laser.y + g.laser.h} y2={g.mInY - 3} stroke="#fff" strokeWidth={8} opacity={0.3} filter="url(#glow)" />
        <PixelBar lane={g.down} y={g.mInY} h={8} values={xCols} />
        <text x={g.down.x + g.down.w + 8} y={g.mInY + 7} className="t-mono">M_in · xₜ</text>
        <path d={profilePath(xCols, g.down, g.mInY + 10, g.couplerInY - 2, 1)} fill="#fff" opacity={rec?.injected ? 0.32 : 0.07} filter="url(#glow)" />

        {/* chamber */}
        <rect {...g.chamber} rx={6} className="chamber" />
        <text x={g.chamber.x + g.chamber.w} y={g.chamber.y - 8} className="t-title" textAnchor="end">recurrent photon chamber</text>
        <text x={g.down.x + 2} y={g.chamber.y + 17} className="t-small dim">↓ forward pass</text>
        <text x={g.up.x + g.up.w - 2} y={g.chamber.y + 17} className="t-small dim" textAnchor="end">↑ return pass</text>
        {[g.chamber.x + 3, g.chamber.x + g.chamber.w - 3].map((wx) => (
          <line key={wx} x1={wx} x2={wx} y1={g.chamber.y + 8} y2={g.chamber.y + g.chamber.h - 8} className={p.walls === 'absorb' ? 'wall absorb' : 'wall'} />
        ))}

        {lanes && (
          <g className="rays">
            <g clipPath="url(#clip-down)">
              <path d={envelope(rec.down, g.down, -1)} />
              <path d={envelope(rec.down, g.down, 1)} />
            </g>
            <g clipPath="url(#clip-up)">
              <path d={envelope(rec.up, g.up, -1)} />
              <path d={envelope(rec.up, g.up, 1)} />
            </g>
          </g>
        )}

        <path d={`M${g.up.cx},${g.couplerInY - 4} C${g.up.cx},${g.couplerInY - 26} ${g.down.cx},${g.couplerInY - 26} ${g.down.cx},${g.couplerInY - 6}`} className="loop" markerEnd="url(#arr)" />
        <path d={`M${g.down.cx},${g.couplerOutY + 4} C${g.down.cx},${g.couplerOutY + 26} ${g.up.cx},${g.couplerOutY + 26} ${g.up.cx},${g.couplerOutY + 6}`} className="loop" markerEnd="url(#arr)" />

        <line x1={g.down.x - 14} x2={g.up.x + g.up.w + 14} y1={g.couplerInY} y2={g.couplerInY} className="coupler" />
        <text x={g.up.x + g.up.w + 14} y={g.couplerInY - 7} className="t-mono dim" textAnchor="end">R_in {p.rIn}</text>
        <line x1={g.down.x - 14} x2={g.up.x + g.up.w + 14} y1={g.couplerOutY} y2={g.couplerOutY} className="coupler" />
        <text x={g.up.x + g.up.w + 14} y={g.couplerOutY + 16} className="t-mono dim" textAnchor="end">R_out {p.rOut}</text>

        <rect x={g.down.x - 8} y={g.gainY - 3} width={g.up.x + g.up.w - g.down.x + 16} height={6} className="gain" />

        {masks.map((mask, k) => {
          const y = g.planeY(k)
          const phases = midRow(mask)
          return (
            <g key={k} className={hoverPlane === k ? 'plane hover' : 'plane'}>
              <PixelBar lane={g.down} y={y - 4} h={8} phases={phases} />
              <PixelBar lane={g.up} y={y - 4} h={8} phases={phases} />
              <line x1={g.down.x + g.down.w} x2={g.up.x} y1={y} y2={y} className="plane-bridge" />
              <text x={g.chamber.x + 8} y={y + 3} className="t-mono small">{k + 1}</text>
              {hoverPlane === k && (
                <>
                  <Cones lane={g.down} y={y} dy={gapPx} half={coneHalf} dir={1} />
                  <Cones lane={g.up} y={y} dy={gapPx} half={coneHalf} dir={-1} />
                </>
              )}
            </g>
          )
        })}
        {hoverPlane !== null && (
          <text x={g.up.x + g.up.w} y={g.planeY(hoverPlane) - 8} className="t-small hl" textAnchor="end">
            θ = 1.22λ/D = {m.theta.toFixed(4)} rad · ≈{m.nEff.toFixed(1)} efferent px
          </text>
        )}

        {probe && (
          <g className="probe">
            <line x1={(probe.lane === 'down' ? g.down : g.up).x} x2={(probe.lane === 'down' ? g.down : g.up).x + g.down.w} y1={g.rowY(probe.row)} y2={g.rowY(probe.row)} />
            <circle cx={(probe.lane === 'down' ? g.down : g.up).x + g.down.w} cy={g.rowY(probe.row)} r={3} />
          </g>
        )}

        {/* readout path: coupler → M_out → lens → CCD */}
        {readout && <path d={profilePath(Array.from(readout, Math.sqrt), g.down, g.couplerOutY + 2, g.mOutY - 2, 0.92)} fill="#fff" opacity={0.4} filter="url(#glow)" />}
        <PixelBar lane={g.down} y={g.mOutY} h={8} phases={midRow(mOut)} />
        <text x={g.down.x + g.down.w + 8} y={g.mOutY + 7} className="t-mono">M_out</text>
        <path d={`M${g.down.x + 10},${g.mOutY + 12} L${g.ccd.x + g.ccd.w / 2},${g.ccd.y - 2} L${g.down.x + g.down.w - 10},${g.mOutY + 12}`} fill="#fff" opacity={0.1} />
        <ellipse cx={g.down.cx} cy={g.lensY} rx={g.down.w / 2 + 6} ry={9} className="lens" />
        <text x={g.down.x + g.down.w + 12} y={g.lensY + 4} className="t-small dim">lens</text>
        <rect {...g.ccd} rx={3} className="part" />
        {ccdRow && <CCDCells row={ccdRow} g={g} />}
        <text x={g.ccd.x + g.ccd.w / 2} y={g.ccd.y + g.ccd.h + 16} className="t-title" textAnchor="middle">CCD · yₜ</text>
      </svg>
    </div>
  )
}

function columnMax(amp: Float32Array) {
  const L = LCD_PIXELS
  const out = new Array(L).fill(0)
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) out[x] = Math.max(out[x], amp[y * L + x])
  return out
}

function PixelBar({ lane, y, h, phases, values }: { lane: Lane; y: number; h: number; phases?: number[]; values?: number[] }) {
  const w = lane.w / LCD_PIXELS
  return (
    <g>
      <rect x={lane.x} y={y} width={lane.w} height={h} className="pixbar" />
      {Array.from({ length: LCD_PIXELS }, (_, i) => {
        const v = phases ? 0.16 + 0.6 * (((phases[i] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) : 0.06 + 0.94 * values![i]
        return <rect key={i} x={lane.x + i * w} y={y + 1} width={w - 0.3} height={h - 2} fill="#fff" opacity={v} />
      })}
    </g>
  )
}

function Cones({ lane, y, dy, half, dir }: { lane: Lane; y: number; dy: number; half: number; dir: 1 | -1 }) {
  const n = 9
  return (
    <g className="cones">
      {Array.from({ length: n }, (_, i) => {
        const cx = lane.x + ((i + 0.5) / n) * lane.w
        const y2 = y + dir * dy
        return <path key={i} d={`M${cx},${y} L${cx - half},${y2} L${cx + half},${y2} Z`} />
      })}
    </g>
  )
}

/** A beam drawn as the filled extent of its amplitude profile, flowing between two heights. */
function profilePath(amp: ArrayLike<number>, lane: Lane, y0: number, y1: number, taper: number) {
  let mx = 0
  for (let i = 0; i < amp.length; i++) mx = Math.max(mx, amp[i])
  if (mx === 0) return ''
  const n = amp.length
  let left = n, right = -1
  for (let i = 0; i < n; i++) if (amp[i] > mx * 0.05) { left = Math.min(left, i); right = Math.max(right, i) }
  if (right < 0) return ''
  const xa = lane.x + (left / n) * lane.w
  const xb = lane.x + ((right + 1) / n) * lane.w
  const shrink = ((xb - xa) * (1 - taper)) / 2
  return `M${xa},${y0} L${xb},${y0} L${xb - shrink},${y1} L${xa + shrink},${y1} Z`
}

function CCDCells({ row, g }: { row: Float32Array; g: Geometry }) {
  const bins = 64
  const w = g.ccd.w / bins
  const vals = new Float64Array(bins)
  for (let i = 0; i < row.length; i++) vals[(i * bins / row.length) | 0] += row[i]
  const mx = Math.max(...vals) || 1
  return (
    <g>
      {Array.from(vals, (b, i) => (
        <rect key={i} x={g.ccd.x + i * w + 0.3} y={g.ccd.y + 4} width={w - 0.6} height={g.ccd.h - 8} fill="#fff" opacity={Math.sqrt(b / mx)} />
      ))}
    </g>
  )
}
