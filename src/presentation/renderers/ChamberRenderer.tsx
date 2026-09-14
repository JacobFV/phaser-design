import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { evaluateProgram } from '../../core/physics/elements/pixels'
import { isProgrammable, programOf } from '../../core/physics/elements/types'
import type { SimulationConfig } from '../../core/runtime/config'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { rgbToBytes, rgbToCss, type RGB } from '../color/spectrum'
import type { ChamberLayout, Lane, Plane } from '../layouts/chamberLayout'
import { maxIntensity, paintCarrier, sideRows, type SideRow } from './sideView'

export interface ProbeTarget {
  stepIndex: number
  fraction: number
}

interface Props {
  layout: ChamberLayout
  config: SimulationConfig
  snapshot: SimulationSnapshot | null
  previous: SimulationSnapshot | null
  progress: number // 0..1 through the displayed round trip (forward lane, then return lane)
  probe: ProbeTarget | null
  onProbe: (p: ProbeTarget | null) => void
  selected: string | null
  onSelect: (elementId: string) => void
  tint: RGB // display colour of the light
}

const SUPER = 2
const mm = (m: number) => `${(m * 1e3).toFixed(m * 1e3 < 10 ? 1 : 0)} mm`
const LAMBDA_VIS = 16 // displayed crest spacing, viewBox units (real crests would be invisible)
const CREST_SPEED = 26

const nullAssets = { get: () => { throw new Error('array program not available on the UI thread') } }

/** Centre-row phases of a programmable element for display; arrays uploaded to the worker show as a neutral bar. */
function centreRow(config: SimulationConfig, id: string): number[] | null {
  const spec = config.physics.elements.find((e) => e.id === id)
  if (!spec || !isProgrammable(spec)) return null
  const px = spec.kind === 'lcd-microlens' ? spec.lcd.pixels : spec.pixels
  const program = programOf(spec)
  if (program.kind === 'array') return null
  const all = evaluateProgram(program, px.resolution.x, px.resolution.y, nullAssets)
  const row = Math.floor(px.resolution.y / 2) * px.resolution.x
  const cols = Math.min(px.resolution.x, 96)
  return Array.from({ length: cols }, (_, i) => all[row + Math.floor((i * px.resolution.x) / cols)])
}

export function ChamberRenderer({ layout: g, config, snapshot, previous, progress, probe, onProbe, selected, onSelect, tint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const pd = Math.min(1, progress * 2)
  const pu = Math.max(0, progress * 2 - 1)

  const live = useRef({ snapshot, previous, pd, pu, g, progress, tint })
  live.current = { snapshot, previous, pd, pu, g, progress, tint }

  // carrier animation runs on its own frame loop fed by refs, independent of the simulation clock
  useEffect(() => {
    let raf = 0
    const bufs = new Map<string, { canvas: HTMLCanvasElement; img: ImageData }>()
    const buffer = (key: string, nx: number, rows: number) => {
      let b = bufs.get(key)
      if (!b || b.img.width !== nx || b.img.height !== rows) {
        const canvas = document.createElement('canvas')
        canvas.width = nx
        canvas.height = Math.max(1, rows)
        b = { canvas, img: canvas.getContext('2d')!.createImageData(nx, Math.max(1, rows)) }
        bufs.set(key, b)
      }
      return b
    }
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const ctx = canvasRef.current?.getContext('2d')
      const L = live.current
      if (!ctx) return
      const { g } = L
      const T = g.turnaround
      ctx.setTransform(SUPER, 0, 0, SUPER, 0, 0)
      ctx.clearRect(0, 0, g.vbW, g.vbH)
      ctx.fillStyle = '#000'
      ctx.fillRect(g.down.x, g.topY, g.down.w, g.bottomY - g.topY)
      ctx.fillRect(g.up.x, g.topY, g.up.w, g.bottomY - g.topY)
      ctx.imageSmoothingEnabled = true

      const lanePosition = (row: SideRow, pass: 'forward' | 'return') => (pass === 'forward' ? row.distance : 2 * T - row.distance)
      const paintLane = (snap: SimulationSnapshot, pass: 'forward' | 'return', lane: Lane, reveal: [number, number], alpha: number, animate: boolean) => {
        const view = snap.physics.sideView
        if (!view) return
        const rows = sideRows(snap.physics.route, view, pass)
        if (rows.length < 2) return
        const norm = Math.max(maxIntensity(sideRows(snap.physics.route, view, 'all')), 1e-300)
        const b = buffer(`${pass}${alpha}`, view.nx, rows.length)
        const pos = (r: SideRow) => g.yAt(lanePosition(r, pass))
        const bytes = rgbToBytes(L.tint)
        if (animate) paintCarrier(b.img, rows, norm, pos, pass === 'forward' ? 1 : -1, now / 1000, LAMBDA_VIS, CREST_SPEED, bytes)
        else paintCarrier(b.img, rows, norm, () => 0, 1, 0, 1e12, 0, bytes)
        b.canvas.getContext('2d')!.putImageData(b.img, 0, 0)
        ctx.globalAlpha = alpha
        const [lo, hi] = reveal
        for (let r = 0; r < rows.length - 1; r++) {
          let y0 = pos(rows[r]), y1 = pos(rows[r + 1])
          if (y0 > y1) [y0, y1] = [y1, y0]
          const f0 = (y0 - g.topY) / (g.bottomY - g.topY), f1 = (y1 - g.topY) / (g.bottomY - g.topY)
          const c0 = Math.max(f0, lo), c1 = Math.min(f1, hi)
          if (c1 <= c0) continue
          ctx.drawImage(b.canvas, 0, r, view.nx, 1, lane.x, g.topY + c0 * (g.bottomY - g.topY), lane.w, Math.max(0.6, (c1 - c0) * (g.bottomY - g.topY)))
        }
        ctx.globalAlpha = 1
      }

      if (L.previous) {
        paintLane(L.previous, 'forward', g.down, [L.pd, 1], 0.28, false)
        paintLane(L.previous, 'return', g.up, [0, 1 - L.pu], 0.28, false)
      }
      if (L.snapshot) {
        paintLane(L.snapshot, 'forward', g.down, [0, L.pd], 1, true)
        paintLane(L.snapshot, 'return', g.up, [1 - L.pu, 1], 1, true)
      }
      if (L.progress < 1) {
        const lane = L.progress < 0.5 ? g.down : g.up
        const y = g.topY + (L.progress < 0.5 ? L.pd : 1 - L.pu) * (g.bottomY - g.topY)
        const grad = ctx.createLinearGradient(0, y - 12, 0, y + 12)
        grad.addColorStop(0, rgbToCss(L.tint, 0))
        grad.addColorStop(0.5, rgbToCss(L.tint, 0.9))
        grad.addColorStop(1, rgbToCss(L.tint, 0))
        ctx.fillStyle = grad
        ctx.fillRect(lane.x, y - 12, lane.w, 24)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toVB = (e: MouseEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse())
  const onMove = (e: MouseEvent) => {
    const { x, y } = toVB(e)
    const near = g.planes.find((p) => Math.abs(p.y - y) < 7 && x > g.down.x && x < g.up.x + g.up.w)
    setHover(near?.elementId ?? null)
  }
  const onClick = (e: MouseEvent) => {
    const { x, y } = toVB(e)
    if (hover) return onSelect(hover)
    const h = g.hit(x, y)
    if (h) onProbe(h)
  }

  const sv = snapshot?.physics.sideView
  const envelope = (pass: 'forward' | 'return', lane: Lane, sign: -1 | 1) => {
    if (!snapshot || !sv) return ''
    const rows = sideRows(snapshot.physics.route, sv, pass)
    return rows.map((row, i) => {
      let s = 0, sx = 0, sxx = 0
      const n = row.proj.I.length
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n
        s += row.proj.I[k]; sx += u * row.proj.I[k]; sxx += u * u * row.proj.I[k]
      }
      const c = s > 0 ? sx / s : 0.5
      const w = s > 0 ? Math.sqrt(Math.max(0, sxx / s - c * c)) : 0
      const u = Math.min(1, Math.max(0, c + 2 * sign * w))
      const y = g.yAt(pass === 'forward' ? row.distance : 2 * g.turnaround - row.distance)
      return `${i ? 'L' : 'M'}${(lane.x + u * lane.w).toFixed(1)},${y.toFixed(1)}`
    }).join('')
  }

  const readoutImg = snapshot?.physics.readouts[0]
  const inputPorts = config.computation.ports.filter((p) => p.direction === 'input')
  const spanY = g.bottomY - g.topY
  const probeY = (() => {
    if (!probe || !snapshot) return null
    const s = snapshot.physics.route.steps[probe.stepIndex]
    if (!s || s.kind !== 'propagate') return null
    const d = s.distance + s.length * probe.fraction
    return { y: g.yAt(s.pass === 'forward' ? d : 2 * g.turnaround - d), lane: s.pass === 'forward' ? g.down : g.up }
  })()

  return (
    <div className="sim" style={{ aspectRatio: `${g.vbW} / ${g.vbH}` }}>
      <canvas ref={canvasRef} width={g.vbW * SUPER} height={g.vbH * SUPER} />
      <svg ref={svgRef} viewBox={`0 0 ${g.vbW} ${g.vbH}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0.8 L7,4 L0,7.2" fill="none" stroke="#fff" strokeWidth="1.3" />
          </marker>
          <clipPath id="clip-down"><rect x={g.down.x} y={g.topY} width={g.down.w} height={pd * spanY} /></clipPath>
          <clipPath id="clip-up"><rect x={g.up.x} y={g.bottomY - pu * spanY} width={g.up.w} height={pu * spanY} /></clipPath>
        </defs>

        {/* laser and input port */}
        <rect {...g.laser} rx={4} className="part" />
        <text x={g.laser.x + g.laser.w / 2} y={g.laser.y + 21} className="t-title" textAnchor="middle">input</text>
        <text x={g.laser.x + g.laser.w / 2} y={g.laser.y + 37} className="t-small dim" textAnchor="middle">λ = {(config.physics.field.wavelength * 1e9).toFixed(0)} nm</text>
        <line x1={g.down.cx} x2={g.down.cx} y1={g.laser.y + g.laser.h} y2={g.topY - 8} className="beam" strokeWidth={6} opacity={0.35} filter="url(#glow)" />
        {inputPorts.length > 0 && (
          <text x={g.down.x + g.down.w + 10} y={g.inputY + 4} className="t-mono faint">ports {inputPorts.map((p) => `${p.id}→${'physicalPort' in p ? p.physicalPort : ''}`).join(' · ')}</text>
        )}

        {/* chamber */}
        <rect {...g.chamber} rx={6} className="chamber" />
        <text x={g.chamber.x + g.chamber.w} y={g.chamber.y - 8} className="t-title" textAnchor="end">
          linear reciprocal cavity · {(g.turnaround * 1e3).toFixed(1)} mm each way
        </text>
        <text x={g.down.x + 2} y={g.chamber.y + 17} className="t-small dim">↓ forward (front faces)</text>
        <text x={g.up.x + g.up.w - 2} y={g.chamber.y + 17} className="t-small dim" textAnchor="end">↑ return (back faces)</text>
        {/* distance scale along the axis: start, every element plane, end */}
        <g className="ruler">
          <text x={g.down.x + 3} y={g.topY + 12} className="t-mono small halo">0</text>
          {g.planes.map((p) => <text key={p.elementId} x={g.down.x + 3} y={p.y + 13} className="t-mono small halo">{mm(p.position)}</text>)}
          <text x={g.down.x + 3} y={g.bottomY - 5} className="t-mono small halo">{mm(g.turnaround)}</text>
        </g>
        {config.physics.field.boundary.kind === 'periodic' && (
          <text x={g.chamber.x + 6} y={g.chamber.y + g.chamber.h - 8} className="t-mono small">periodic boundary</text>
        )}

        {snapshot && sv && (
          <g className="rays">
            <g clipPath="url(#clip-down)"><path d={envelope('forward', g.down, -1)} /><path d={envelope('forward', g.down, 1)} /></g>
            <g clipPath="url(#clip-up)"><path d={envelope('return', g.up, -1)} /><path d={envelope('return', g.up, 1)} /></g>
          </g>
        )}

        <path d={`M${g.up.cx},${g.topY - 4} C${g.up.cx},${g.topY - 26} ${g.down.cx},${g.topY - 26} ${g.down.cx},${g.topY - 6}`} className="loop" markerEnd="url(#arr)" />
        <path d={`M${g.down.cx},${g.bottomY + 4} C${g.down.cx},${g.bottomY + 26} ${g.up.cx},${g.bottomY + 26} ${g.up.cx},${g.bottomY + 6}`} className="loop" markerEnd="url(#arr)" />

        <Assembly items={g.start} y={g.topY} g={g} above selected={selected} />
        <Assembly items={g.end} y={g.bottomY} g={g} above={false} selected={selected} />

        {g.planes.map((p) => (
          <PlaneGlyph key={p.elementId} p={p} g={g} phases={centreRow(config, p.elementId)} hover={hover === p.elementId} selected={selected === p.elementId} />
        ))}

        {probeY && (
          <g className="probe">
            <line x1={probeY.lane.x} x2={probeY.lane.x + probeY.lane.w} y1={probeY.y} y2={probeY.y} />
            <circle cx={probeY.lane.x + probeY.lane.w} cy={probeY.y} r={3} />
          </g>
        )}

        {/* readout chain */}
        {g.readout && (
          <g>
            <path
              d={g.readout.tapAt === 'end'
                ? `M${g.down.cx},${g.bottomY + 2} L${g.down.cx},${(g.readout.stageY[0] ?? g.readout.detector.y) - 6}`
                : `M${g.chamber.x + g.chamber.w + 4},${g.topY} L${g.chamber.x + g.chamber.w + 20},${g.topY} L${g.chamber.x + g.chamber.w + 20},${g.readout.detector.y - 20} L${g.down.cx},${g.readout.detector.y - 20} L${g.down.cx},${(g.readout.stageY[0] ?? g.readout.detector.y) - 6}`}
              className="tap-path" markerEnd="url(#arr)"
            />
            {g.readout.stageLabels.map((label, i) => (
              <g key={i}>
                <rect x={g.down.x} y={g.readout!.stageY[i] - 4} width={g.down.w} height={8} className="pixbar" />
                <text x={g.down.x + g.down.w + 8} y={g.readout!.stageY[i] + 4} className="t-mono">{label}</text>
              </g>
            ))}
            <rect {...g.readout.detector} rx={3} className="part" />
            {readoutImg && <DetectorCells img={readoutImg} box={g.readout.detector} />}
            <text x={g.readout.detector.x + g.readout.detector.w / 2} y={g.readout.detector.y + g.readout.detector.h + 16} className="t-title" textAnchor="middle">
              {config.physics.readouts[0].detector.kind === 'fourier-plane' ? 'Fourier-plane detector' : 'near-field detector'} · {g.readout.id}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

function Assembly({ items, y, g, above, selected }: { items: ChamberLayout['start']; y: number; g: ChamberLayout; above: boolean; selected: string | null }) {
  return (
    <g>
      <line x1={g.down.x - 14} x2={g.up.x + g.up.w + 14} y1={y} y2={y} className="coupler" />
      {/* right-aligned beside the outer edge; long assemblies stack one item per line so the text never crosses the loop arc */}
      {(() => {
        const labels = items.map((it) => (it.elementId === selected ? `[${it.label}]` : it.label))
        const lines = labels.join(' + ').length > 18 ? labels.map((l, i) => (i < labels.length - 1 ? `${l} +` : l)) : [labels.join(' + ')]
        const x = g.up.x + g.up.w + 14
        const y0 = above ? y - 9 - (lines.length - 1) * 11 : y + 44
        return lines.map((l, i) => <text key={i} x={x} y={y0 + i * 11} className="t-mono dim" textAnchor="end">{l}</text>)
      })()}
    </g>
  )
}

function PlaneGlyph({ p, g, phases, hover, selected }: { p: Plane; g: ChamberLayout; phases: number[] | null; hover: boolean; selected: boolean }) {
  const cls = `plane${hover ? ' hover' : ''}${selected ? ' selected' : ''}`
  const bar = (lane: Lane) => {
    if (p.kind === 'lens' || p.kind === 'microlens-array') return <ellipse cx={lane.cx} cy={p.y} rx={lane.w / 2} ry={6} className="lens" />
    if (p.kind === 'gain') return <rect x={lane.x} y={p.y - 3} width={lane.w} height={6} className="gain" />
    if (p.kind === 'nonlinear') return <rect x={lane.x} y={p.y - 3} width={lane.w} height={6} className="nonlinear" />
    if (p.kind === 'aperture') return <g><rect x={lane.x} y={p.y - 3} width={14} height={6} className="stop" /><rect x={lane.x + lane.w - 14} y={p.y - 3} width={14} height={6} className="stop" /></g>
    if (p.kind === 'mirror' || p.kind === 'coupler') return <line x1={lane.x} x2={lane.x + lane.w} y1={p.y} y2={p.y} className="coupler" />
    const w = lane.w / (phases?.length || 1)
    return (
      <g>
        <rect x={lane.x} y={p.y - 4} width={lane.w} height={8} className="pixbar" />
        {phases?.map((ph, i) => (
          <rect key={i} x={lane.x + i * w} y={p.y - 3} width={Math.max(0.3, w - 0.3)} height={6} fill="#fff" opacity={0.16 + (0.6 * (((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))) / (2 * Math.PI)} />
        ))}
        {!phases && <rect x={lane.x} y={p.y - 3} width={lane.w} height={6} className="pixbar-array" />}
        {p.kind === 'lcd-microlens' && <ellipse cx={lane.cx} cy={p.y + 7} rx={lane.w / 2} ry={3} className="lens" />}
      </g>
    )
  }
  return (
    <g className={cls}>
      {bar(g.down)}
      {bar(g.up)}
      <line x1={g.down.x + g.down.w} x2={g.up.x} y1={p.y} y2={p.y} className="plane-bridge" />
    </g>
  )
}

function DetectorCells({ img, box }: { img: NonNullable<SimulationSnapshot['physics']['readouts'][number]>; box: { x: number; y: number; w: number; h: number } }) {
  const bins = 64
  const vals = new Float64Array(bins)
  for (let j = 0; j < img.ny; j++) for (let i = 0; i < img.nx; i++) vals[Math.floor((i * bins) / img.nx)] += img.intensity[j * img.nx + i]
  const mx = Math.max(...vals) || 1
  const w = box.w / bins
  return <g>{Array.from(vals, (v, i) => <rect key={i} x={box.x + i * w + 0.3} y={box.y + 4} width={w - 0.6} height={box.h - 8} className="light-fill" opacity={Math.sqrt(v / mx)} />)}</g>
}
