import type { ElementKind, OpticalElementSpec } from '../../core/physics/elements/types'
import type { Route } from '../../core/physics/topology/topology'
import type { SimulationConfig } from '../../core/runtime/config'

/**
 * Folded two-lane schematic for linear-reciprocal routes, derived entirely from the compiled route and config.
 * Presentation geometry only: the solver never sees any of these coordinates.
 */
export interface Lane {
  x: number
  w: number
  cx: number
}

export interface Plane {
  elementId: string
  kind: ElementKind
  label: string
  position: number // m from the start assembly
  y: number
}

export interface ChamberLayout {
  vbW: number
  vbH: number
  turnaround: number // one-way length, m
  laser: { x: number; y: number; w: number; h: number }
  inputY: number
  chamber: { x: number; y: number; w: number; h: number }
  down: Lane
  up: Lane
  topY: number // start assembly
  bottomY: number // end assembly (turnaround)
  yAt: (position: number) => number
  planes: Plane[]
  start: { elementId: string; kind: ElementKind; label: string }[]
  end: { elementId: string; kind: ElementKind; label: string }[]
  readout: { id: string; tapAt: 'start' | 'end' | 'plane'; stageY: number[]; stageLabels: string[]; detector: { x: number; y: number; w: number; h: number } } | null
  elementAnchor: (id: string) => { x: number; y: number } | null
  stepAnchor: (stepIndex: number) => { x: number; y: number } | null
  hit: (x: number, y: number) => { stepIndex: number; fraction: number } | null
}

export const isChamberRoute = (route: Route) => route.hint.topology === 'linear-reciprocal' && route.hint.turnaround !== undefined

export function chamberLayout(config: SimulationConfig, route: Route): ChamberLayout {
  const T = route.hint.turnaround!
  const specs = new Map(config.physics.elements.map((e) => [e.id, e]))
  const info = (id: string) => {
    const s = specs.get(id) as OpticalElementSpec
    return { elementId: id, kind: s.kind, label: s.label ?? id }
  }
  const down: Lane = { x: 84, w: 188, cx: 178 }
  const up: Lane = { x: 292, w: 188, cx: 386 }
  const topY = 180
  const bottomY = 812
  const yAt = (p: number) => topY + (T > 0 ? p / T : 0) * (bottomY - topY)

  const start: ChamberLayout['start'] = []
  const end: ChamberLayout['end'] = []
  const planes: Plane[] = []
  const seen = new Set<string>()
  for (const s of route.steps) {
    if (s.kind !== 'element') continue
    if (s.pass === 'forward' && s.distance <= 1e-12) start.push(info(s.elementId))
    else if (s.pass === 'return' && Math.abs(s.distance - T) <= 1e-12 && !seen.has(s.elementId)) end.push(info(s.elementId))
    else if (s.pass === 'forward' && !seen.has(s.elementId)) planes.push({ ...info(s.elementId), position: s.distance, y: yAt(s.distance) })
    seen.add(s.elementId)
  }

  const r = config.physics.readouts[0]
  let readout: ChamberLayout['readout'] = null
  if (r) {
    const tapEl = config.physics.elements.find((e) => e.kind === 'coupler' && e.outputTap === r.tap)
    const tapAt = tapEl && start.some((s) => s.elementId === tapEl.id) ? 'start' : tapEl && end.some((s) => s.elementId === tapEl.id) ? 'end' : 'plane'
    const stageLabels = r.stages.map((st) => (st.kind === 'propagate' ? `${(st.length * 1e3).toFixed(0)} mm` : st.element.label ?? st.element.id))
    const stageY = stageLabels.map((_, i) => 880 + i * 44)
    const detY = 880 + stageLabels.length * 44 + 40
    readout = { id: r.id, tapAt, stageY, stageLabels, detector: { x: down.cx - 80, y: detY, w: 160, h: 26 } }
  }
  const vbH = readout ? readout.detector.y + 70 : 870

  const stepPosition = (i: number): { p: number; lane: Lane } | null => {
    const s = route.steps[i]
    if (!s) return null
    const endD = s.distance + (s.kind === 'propagate' ? s.length : 0)
    if (s.pass === 'forward') return { p: Math.min(T, endD), lane: down }
    if (s.pass === 'return') return { p: Math.max(0, 2 * T - endD), lane: up }
    return null
  }

  return {
    vbW: 560,
    vbH,
    turnaround: T,
    laser: { x: down.cx - 58, y: 14, w: 116, h: 46 },
    inputY: 96,
    chamber: { x: 52, y: 134, w: 460, h: 712 },
    down,
    up,
    topY,
    bottomY,
    yAt,
    planes,
    start,
    end,
    readout,
    elementAnchor: (id) => {
      if (start.some((s) => s.elementId === id)) return { x: down.x - 14, y: topY }
      if (end.some((s) => s.elementId === id)) return { x: down.x - 14, y: bottomY }
      const pl = planes.find((p) => p.elementId === id)
      return pl ? { x: 64, y: pl.y } : null
    },
    stepAnchor: (i) => {
      const sp = stepPosition(i)
      return sp ? { x: sp.lane.x + sp.lane.w, y: yAt(sp.p) } : null
    },
    hit: (x, y) => {
      if (y < topY || y > bottomY || T <= 0) return null
      const p = ((y - topY) / (bottomY - topY)) * T
      const inDown = x >= down.x && x <= down.x + down.w
      const inUp = x >= up.x && x <= up.x + up.w
      if (!inDown && !inUp) return null
      const d = inDown ? p : 2 * T - p
      const pass = inDown ? 'forward' : 'return'
      for (let i = 0; i < route.steps.length; i++) {
        const s = route.steps[i]
        if (s.kind === 'propagate' && s.pass === pass && d >= s.distance - 1e-12 && d <= s.distance + s.length + 1e-12)
          return { stepIndex: i, fraction: (d - s.distance) / s.length }
      }
      return null
    },
  }
}
