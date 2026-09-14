import { useEffect, useRef, type MouseEvent } from 'react'
import type { SimulationConfig } from '../../core/runtime/config'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import type { RouteLayout, RouteMark } from '../layouts/routeLayout'
import type { ProbeTarget } from './ChamberRenderer'
import { maxIntensity, paintCarrier, sideRows } from './sideView'

interface Props {
  layout: RouteLayout
  config: SimulationConfig
  snapshot: SimulationSnapshot | null
  progress: number
  probe: ProbeTarget | null
  onProbe: (p: ProbeTarget | null) => void
  selected: string | null
  onSelect: (elementId: string) => void
}

const SUPER = 2

/** Unfolded round trip for any topology. Simpler than the chamber artwork but driven by the same snapshots. */
export function RouteRenderer({ layout: g, config, snapshot, progress, probe, onProbe, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const live = useRef({ snapshot, g, progress })
  live.current = { snapshot, g, progress }

  useEffect(() => {
    let raf = 0
    let buf: { canvas: HTMLCanvasElement; img: ImageData } | null = null
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const ctx = canvasRef.current?.getContext('2d')
      const { snapshot: snap, g, progress } = live.current
      if (!ctx) return
      ctx.setTransform(SUPER, 0, 0, SUPER, 0, 0)
      ctx.clearRect(0, 0, g.vbW, g.vbH)
      ctx.fillStyle = '#000'
      ctx.fillRect(g.lane.x, g.y0, g.lane.w, g.y1 - g.y0)
      const view = snap?.physics.sideView
      if (!snap || !view) return
      const rows = sideRows(snap.physics.route, view, 'all')
      if (rows.length < 2) return
      if (!buf || buf.img.width !== view.nx || buf.img.height !== rows.length) {
        const canvas = document.createElement('canvas')
        canvas.width = view.nx
        canvas.height = rows.length
        buf = { canvas, img: canvas.getContext('2d')!.createImageData(view.nx, rows.length) }
      }
      paintCarrier(buf.img, rows, Math.max(maxIntensity(rows), 1e-300), (r) => g.yAt(r.distance), 1, now / 1000, 16, 26)
      buf.canvas.getContext('2d')!.putImageData(buf.img, 0, 0)
      const revealY = g.y0 + progress * (g.y1 - g.y0)
      for (let r = 0; r < rows.length - 1; r++) {
        const ya = g.yAt(rows[r].distance), yb = Math.min(g.yAt(rows[r + 1].distance), revealY)
        if (yb <= ya) continue
        ctx.drawImage(buf.canvas, 0, r, view.nx, 1, g.lane.x, ya, g.lane.w, Math.max(0.6, yb - ya))
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toVB = (e: MouseEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse())
  const onClick = (e: MouseEvent) => {
    const { x, y } = toVB(e)
    const mark = g.marks.find((m) => Math.abs(m.y - y) < 6)
    if (mark && x < g.lane.x + g.lane.w + 40) return onSelect(mark.elementId)
    const h = g.hit(x, y)
    if (h) onProbe(h)
  }

  const topo = config.physics.topology
  const probeY = probe && snapshot ? (() => {
    const s = snapshot.physics.route.steps[probe.stepIndex]
    return s && s.kind === 'propagate' ? g.yAt(s.distance + s.length * probe.fraction) : null
  })() : null

  return (
    <div className="sim" style={{ aspectRatio: `${g.vbW} / ${g.vbH}` }}>
      <canvas ref={canvasRef} width={g.vbW * SUPER} height={g.vbH * SUPER} />
      <svg ref={svgRef} viewBox={`0 0 ${g.vbW} ${g.vbH}`} onClick={onClick}>
        <text x={g.lane.x + g.lane.w} y={g.y0 - 40} className="t-title" textAnchor="end">
          {topo.kind === 'ring' ? 'ring' : topo.kind === 'custom' ? 'custom route' : 'linear cavity'} · round trip unfolded · {(g.total * 1e3).toFixed(1)} mm
        </text>
        <text x={g.lane.x} y={g.y0 - 12} className="t-small dim">↓ propagation direction (distance along the route)</text>

        {topo.kind === 'ring' && <RingMiniMap config={config} progress={progress} />}

        {g.legs.map((l, i) => (
          <g key={l.id}>
            <line x1={g.lane.x - 60} x2={g.lane.x - 60} y1={l.y0 + 2} y2={l.y1 - 2} className={i % 2 ? 'leg alt' : 'leg'} />
            <text x={g.lane.x - 66} y={(l.y0 + l.y1) / 2} className="t-mono small" textAnchor="end">{l.label}</text>
            <text x={g.lane.x - 66} y={(l.y0 + l.y1) / 2 + 11} className="t-mono small" textAnchor="end">{(l.length * 1e3).toFixed(0)} mm</text>
          </g>
        ))}

        <rect x={g.lane.x} y={g.y0} width={g.lane.w} height={g.y1 - g.y0} className="chamber" />
        {g.marks.map((m) => <Mark key={m.stepIndex} m={m} g={g} selected={selected === m.elementId} />)}

        {probeY !== null && (
          <g className="probe">
            <line x1={g.lane.x} x2={g.lane.x + g.lane.w} y1={probeY} y2={probeY} />
            <circle cx={g.lane.x + g.lane.w} cy={probeY} r={3} />
          </g>
        )}

        {g.readout && (
          <g>
            {g.readout.stageLabels.map((label, i) => (
              <g key={i}>
                <rect x={g.lane.x} y={g.readout!.stageY[i] - 4} width={g.lane.w} height={8} className="pixbar" />
                <text x={g.lane.x + g.lane.w + 8} y={g.readout!.stageY[i] + 4} className="t-mono">{label}</text>
              </g>
            ))}
            <rect {...g.readout.detector} rx={3} className="part" />
            <text x={g.readout.detector.x + g.readout.detector.w / 2} y={g.readout.detector.y + g.readout.detector.h + 16} className="t-title" textAnchor="middle">readout · {g.readout.id}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

function Mark({ m, g, selected }: { m: RouteMark; g: RouteLayout; selected: boolean }) {
  const glyph = () => {
    const { x, w } = g.lane
    switch (m.kind) {
      case 'lens':
      case 'microlens-array': return <ellipse cx={g.lane.cx} cy={m.y} rx={w / 2} ry={6} className="lens" />
      case 'gain': return <rect x={x} y={m.y - 3} width={w} height={6} className="gain" />
      case 'nonlinear': return <rect x={x} y={m.y - 3} width={w} height={6} className="nonlinear" />
      case 'mirror':
      case 'coupler':
      case 'lcos-slm': return <line x1={x - 10} x2={x + w + 10} y1={m.y} y2={m.y} className="coupler" />
      default: return <rect x={x} y={m.y - 4} width={w} height={8} className="pixbar-array" />
    }
  }
  return (
    <g className={selected ? 'mark selected' : 'mark'}>
      {glyph()}
      <text x={g.lane.x + g.lane.w + 14} y={m.y + 4 + m.stack * 11} className="t-mono small">
        {m.label} · {m.side === 'front' ? 'F' : 'B'}
      </text>
    </g>
  )
}

/** Small rectangle showing the ring's legs to scale, with the beam's current position. */
function RingMiniMap({ config, progress }: { config: SimulationConfig; progress: number }) {
  const topo = config.physics.topology
  if (topo.kind !== 'ring' || topo.legs.length !== 4) return null
  const [top, right, , left] = topo.legs
  const maxDim = Math.max(top.length, right.length, left.length)
  const sx = 70 / maxDim
  const w = top.length * sx, hR = right.length * sx, hL = left.length * sx
  const ox = 470, oy = 30
  const pts = [[ox, oy], [ox + w, oy], [ox + w, oy + hR], [ox, oy + hL]]
  const total = topo.legs.reduce((s, l) => s + l.length, 0)
  let d = progress * total
  let pos = pts[0]
  for (let i = 0; i < 4; i++) {
    const len = topo.legs[i].length
    const a = pts[i], b = pts[(i + 1) % 4]
    if (d <= len) { pos = [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len]; break }
    d -= len
  }
  return (
    <g className="minimap">
      <path d={`M${pts.map((p) => p.join(',')).join(' L')} Z`} />
      <circle cx={pos[0]} cy={pos[1]} r={3} />
    </g>
  )
}
