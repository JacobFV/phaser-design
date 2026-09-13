import type { IncidentSide } from '../elements/types'
import type { MediumSpec } from '../media/media'

/**
 * Topologies are compact, editable descriptions of an optical route. They compile to an explicit ordered list of
 * physical operations (element visits with an incident side, and propagation segments). The engine only ever sees
 * that list, so it cannot tell a rectangle from a folded or linear resonator.
 */
export interface PositionedElement {
  elementId: string
  position: number // m from the start of the leg / cavity
}

/** One straight leg of a closed ring. `corner` is the element that turns the beam into the next leg. */
export interface RingLeg {
  id: string
  label?: string
  length: number
  medium: MediumSpec
  items: PositionedElement[]
  corner?: string
}

/** Closed, unidirectional route. Every element is entered from its front face. */
export interface RingTopology {
  kind: 'ring'
  legs: RingLeg[]
}

/** Thin elements lumped at a reflection point and applied once, in order, per visit. */
export interface ReflectorAssembly {
  elementIds: string[]
}

/**
 * Linear resonator: start assembly → items forward (front faces) → end assembly → items backward (back faces) → repeat.
 * Every propagation segment is traversed twice per round trip.
 */
export interface LinearReciprocalTopology {
  kind: 'linear-reciprocal'
  length: number // spacing between the start and end reflectors
  medium: MediumSpec
  start: ReflectorAssembly
  end: ReflectorAssembly
  items: PositionedElement[]
}

export type CustomRouteItem =
  | { kind: 'element'; elementId: string; side: IncidentSide }
  | { kind: 'propagate'; length: number; medium: MediumSpec }

export interface CustomTopology {
  kind: 'custom'
  route: CustomRouteItem[]
}

export type TopologySpec = RingTopology | LinearReciprocalTopology | CustomTopology

export type RoutePass = 'forward' | 'return' | 'ring' | 'custom'

export type RouteStep =
  | { kind: 'element'; elementId: string; side: IncidentSide; distance: number; pass: RoutePass; leg?: string }
  | { kind: 'propagate'; length: number; medium: MediumSpec; distance: number; pass: RoutePass; leg?: string }

/** Presentation hints derived from the topology. The solver never reads these. */
export interface RouteHint {
  topology: TopologySpec['kind']
  legs?: { id: string; label?: string; start: number; length: number }[]
  turnaround?: number // distance along the route where a linear cavity reflects
}

export interface Route {
  steps: RouteStep[]
  geometricLength: number // Σ propagation lengths per round trip, m
  hint: RouteHint
}

const EPS = 1e-12

function sortedItems(items: PositionedElement[], length: number, where: string): PositionedElement[] {
  for (const it of items)
    if (it.position < -EPS || it.position > length + EPS)
      throw new Error(`${where}: element ${it.elementId} at ${it.position} m lies outside [0, ${length}] m`)
  return items.map((it, k) => ({ it, k })).sort((a, b) => a.it.position - b.it.position || a.k - b.k).map((x) => x.it)
}

export function compileRoute(t: TopologySpec): Route {
  const steps: RouteStep[] = []
  let d = 0
  const prop = (length: number, medium: MediumSpec, pass: RoutePass, leg?: string) => {
    if (length < -EPS) throw new Error(`negative propagation length ${length}`)
    if (length <= EPS) return
    steps.push({ kind: 'propagate', length, medium, distance: d, pass, leg })
    d += length
  }
  const el = (elementId: string, side: IncidentSide, pass: RoutePass, leg?: string) =>
    steps.push({ kind: 'element', elementId, side, distance: d, pass, leg })

  switch (t.kind) {
    case 'ring': {
      if (!t.legs.length) throw new Error('ring topology needs at least one leg')
      const legs: NonNullable<RouteHint['legs']> = []
      for (const leg of t.legs) {
        const start = d
        let cursor = 0
        for (const it of sortedItems(leg.items, leg.length, `leg ${leg.id}`)) {
          prop(it.position - cursor, leg.medium, 'ring', leg.id)
          el(it.elementId, 'front', 'ring', leg.id)
          cursor = it.position
        }
        prop(leg.length - cursor, leg.medium, 'ring', leg.id)
        if (leg.corner) el(leg.corner, 'front', 'ring', leg.id)
        legs.push({ id: leg.id, label: leg.label, start, length: leg.length })
      }
      return { steps, geometricLength: d, hint: { topology: 'ring', legs } }
    }
    case 'linear-reciprocal': {
      const items = sortedItems(t.items, t.length, 'linear cavity')
      for (const id of t.start.elementIds) el(id, 'front', 'forward')
      let cursor = 0
      for (const it of items) {
        prop(it.position - cursor, t.medium, 'forward')
        el(it.elementId, 'front', 'forward')
        cursor = it.position
      }
      prop(t.length - cursor, t.medium, 'forward')
      const turnaround = d
      for (const id of t.end.elementIds) el(id, 'front', 'return')
      cursor = t.length
      for (const it of [...items].reverse()) {
        prop(cursor - it.position, t.medium, 'return')
        el(it.elementId, 'back', 'return')
        cursor = it.position
      }
      prop(cursor, t.medium, 'return')
      return { steps, geometricLength: d, hint: { topology: 'linear-reciprocal', turnaround } }
    }
    case 'custom': {
      for (const item of t.route) {
        if (item.kind === 'propagate') prop(item.length, item.medium, 'custom')
        else el(item.elementId, item.side, 'custom')
      }
      return { steps, geometricLength: d, hint: { topology: 'custom' } }
    }
  }
}

/** Every element id referenced by a topology, in first-visit order. */
export function referencedElements(t: TopologySpec): string[] {
  const ids = compileRoute(t).steps.flatMap((s) => (s.kind === 'element' ? [s.elementId] : []))
  return [...new Set(ids)]
}
