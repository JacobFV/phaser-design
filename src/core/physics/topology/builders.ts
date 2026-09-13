import type { MediumSpec } from '../media/media'
import type { LinearReciprocalTopology, PositionedElement, RingTopology } from './topology'

export interface RectangularRingOptions {
  width: number // top and bottom legs
  height: number // default length of both long (left/right) legs
  leftLength?: number // override to deliberately break left/right symmetry
  rightLength?: number
  medium: MediumSpec
  /** corner elements, clockwise from the top-right: [top-right, bottom-right, bottom-left, top-left] */
  corners: [string, string, string, string]
  items?: Partial<Record<'top' | 'right' | 'bottom' | 'left', PositionedElement[]>>
}

/**
 * Symmetric rectangular ring with all four legs explicit. The beam runs top → right → bottom → left, turning at a
 * corner element after each leg. Round-trip length is the true perimeter, not the modulator-stack length.
 */
export function rectangularRing(o: RectangularRingOptions): RingTopology {
  const leg = (id: 'top' | 'right' | 'bottom' | 'left', length: number, corner: string) => ({
    id, label: `${id} leg`, length, medium: o.medium, items: o.items?.[id] ?? [], corner,
  })
  return {
    kind: 'ring',
    legs: [
      leg('top', o.width, o.corners[0]),
      leg('right', o.rightLength ?? o.height, o.corners[1]),
      leg('bottom', o.width, o.corners[2]),
      leg('left', o.leftLength ?? o.height, o.corners[3]),
    ],
  }
}

export interface LinearStackOptions {
  elementIds: string[] // placed at equal spacing
  spacing: number // gap between neighbouring planes and between the outer planes and the reflectors
  medium: MediumSpec
  start: string[]
  end: string[]
}

/** Equally spaced stack between two reflector assemblies: length = (count + 1) · spacing. */
export function linearStack(o: LinearStackOptions): LinearReciprocalTopology {
  return {
    kind: 'linear-reciprocal',
    length: (o.elementIds.length + 1) * o.spacing,
    medium: o.medium,
    start: { elementIds: o.start },
    end: { elementIds: o.end },
    items: o.elementIds.map((elementId, i) => ({ elementId, position: (i + 1) * o.spacing })),
  }
}
