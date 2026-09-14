import type { ElementKind, IncidentSide } from '../../core/physics/elements/types'
import type { Route } from '../../core/physics/topology/topology'
import type { SimulationConfig } from '../../core/runtime/config'

/**
 * Generic schematic for any route: the round trip unfolded along a vertical axis (distance increases downward).
 * Works for rings, custom routes and linear cavities alike; the chamber layout is a folded special case.
 */
export interface RouteMark {
  stepIndex: number
  elementId: string
  kind: ElementKind
  label: string
  side: IncidentSide
  distance: number
  y: number
  stack: number // index among marks sharing the same distance
}

export interface RouteLayout {
  vbW: number
  vbH: number
  total: number
  lane: { x: number; w: number; cx: number }
  y0: number
  y1: number
  yAt: (d: number) => number
  marks: RouteMark[]
  legs: { id: string; label: string; y0: number; y1: number; length: number }[]
  readout: { id: string; stageY: number[]; stageLabels: string[]; detector: { x: number; y: number; w: number; h: number } } | null
  elementAnchor: (id: string) => { x: number; y: number } | null
  stepAnchor: (i: number) => { x: number; y: number } | null
  hit: (x: number, y: number) => { stepIndex: number; fraction: number } | null
}

export function routeLayout(config: SimulationConfig, route: Route): RouteLayout {
  const total = route.geometricLength
  const lane = { x: 170, w: 240, cx: 290 }
  const y0 = 150
  const y1 = 830
  const yAt = (d: number) => y0 + (total > 0 ? d / total : 0) * (y1 - y0)
  const specs = new Map(config.physics.elements.map((e) => [e.id, e]))
  const marks: RouteMark[] = []
  const byDistance = new Map<string, number>()
  route.steps.forEach((s, stepIndex) => {
    if (s.kind !== 'element') return
    const key = s.distance.toFixed(9)
    const stack = byDistance.get(key) ?? 0
    byDistance.set(key, stack + 1)
    const spec = specs.get(s.elementId)
    marks.push({ stepIndex, elementId: s.elementId, kind: spec?.kind ?? 'mirror', label: spec?.label ?? s.elementId, side: s.side, distance: s.distance, y: yAt(s.distance), stack })
  })
  const legs = (route.hint.legs ?? []).map((l) => ({ id: l.id, label: l.label ?? l.id, y0: yAt(l.start), y1: yAt(l.start + l.length), length: l.length }))

  const r = config.physics.readouts[0]
  let readout: RouteLayout['readout'] = null
  if (r) {
    const stageLabels = r.stages.map((st) => (st.kind === 'propagate' ? `${(st.length * 1e3).toFixed(0)} mm` : st.element.label ?? st.element.id))
    const stageY = stageLabels.map((_, i) => 900 + i * 44)
    readout = { id: r.id, stageY, stageLabels, detector: { x: lane.cx - 80, y: 900 + stageLabels.length * 44 + 40, w: 160, h: 26 } }
  }

  return {
    vbW: 560,
    vbH: readout ? readout.detector.y + 70 : 880,
    total, lane, y0, y1, yAt, marks, legs, readout,
    elementAnchor: (id) => {
      const m = marks.find((x) => x.elementId === id)
      return m ? { x: lane.x - 14, y: m.y } : null
    },
    stepAnchor: (i) => {
      const s = route.steps[i]
      if (!s) return null
      return { x: lane.x + lane.w, y: yAt(s.distance + (s.kind === 'propagate' ? s.length : 0)) }
    },
    hit: (x, y) => {
      if (x < lane.x || x > lane.x + lane.w || y < y0 || y > y1) return null
      const d = ((y - y0) / (y1 - y0)) * total
      for (let i = 0; i < route.steps.length; i++) {
        const s = route.steps[i]
        if (s.kind === 'propagate' && d >= s.distance && d <= s.distance + s.length) return { stepIndex: i, fraction: (d - s.distance) / s.length }
      }
      return null
    },
  }
}
