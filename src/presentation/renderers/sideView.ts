import type { Route } from '../../core/physics/topology/topology'
import type { Projection, SideView } from '../../core/runtime/observation'

/** One sampled row of the side view: where it sits along the route and its projection onto x. */
export interface SideRow {
  distance: number // along the route, m
  proj: Projection
}

/** Flatten side-view segments (plus post-step projections) into rows ordered by route distance, per pass. */
export function sideRows(route: Route, view: SideView, pass: 'forward' | 'return' | 'all'): SideRow[] {
  const rows: SideRow[] = []
  for (const seg of view.segments) {
    const step = route.steps[seg.stepIndex]
    if (!step || step.kind !== 'propagate' || (pass !== 'all' && step.pass !== pass)) continue
    seg.rows.forEach((proj, r) => rows.push({ distance: step.distance + (step.length * r) / seg.rows.length, proj }))
    const after = view.after[seg.stepIndex]
    if (after) rows.push({ distance: step.distance + step.length, proj: after })
  }
  return rows.sort((a, b) => a.distance - b.distance)
}

export function maxIntensity(rows: SideRow[]): number {
  let m = 0
  for (const r of rows) for (let i = 0; i < r.proj.I.length; i++) if (r.proj.I[i] > m) m = r.proj.I[i]
  return m
}

/**
 * Paint rows into an N×rows ImageData with a travelling carrier: brightness ∝ |E|·(0.18 + 0.95·cos²(±kz − ωt + φ)).
 * `zOf` maps a row to its displayed position so crests move along the drawn beam.
 */
export function paintCarrier(img: ImageData, rows: SideRow[], norm: number, zOf: (r: SideRow) => number, dir: 1 | -1, time: number, lambdaVis: number, speed: number) {
  const k = (2 * Math.PI) / lambdaVis
  const wt = k * speed * time
  const nx = img.width
  const d = img.data
  rows.forEach((row, r) => {
    const kz = dir * k * zOf(row) - wt
    const { I, re, im } = row.proj
    for (let x = 0; x < nx; x++) {
      const a = norm > 0 ? Math.sqrt(I[x] / norm) : 0
      const c = Math.cos(kz + Math.atan2(im[x], re[x]))
      const v = Math.min(255, 255 * a * (0.18 + 0.95 * c * c))
      const p = (r * nx + x) * 4
      d[p] = d[p + 1] = d[p + 2] = v
      d[p + 3] = 255
    }
  })
}
