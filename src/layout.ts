// Geometry of the 2-D schematic, in SVG viewBox units. Light travels top → bottom.
export const VB_W = 560

export interface Lane {
  x: number
  w: number
  cx: number
}

export interface Geometry {
  vbW: number
  vbH: number
  laser: { x: number; y: number; w: number; h: number }
  mInY: number
  chamber: { x: number; y: number; w: number; h: number }
  down: Lane
  up: Lane
  couplerInY: number
  couplerOutY: number
  gainY: number
  mOutY: number
  lensY: number
  ccd: { x: number; y: number; w: number; h: number }
  rowY: (r: number) => number
  planeY: (g: number) => number
  /** viewBox y → [lane, row] or null if outside the chamber */
  hit: (x: number, y: number) => { lane: 'down' | 'up'; row: number } | null
}

export function geometry(nLcd: number, rows: number, S: number): Geometry {
  const down: Lane = { x: 84, w: 188, cx: 84 + 94 }
  const up: Lane = { x: 292, w: 188, cx: 292 + 94 }
  const couplerInY = 180
  const couplerOutY = 812
  const span = couplerOutY - couplerInY
  const rowY = (r: number) => couplerInY + (r / (rows - 1)) * span
  const gapPx = span / (nLcd + 1)
  return {
    vbW: VB_W,
    vbH: 1050,
    laser: { x: down.cx - 58, y: 14, w: 116, h: 46 },
    mInY: 96,
    chamber: { x: 52, y: 134, w: 460, h: 712 },
    down,
    up,
    couplerInY,
    couplerOutY,
    gainY: couplerOutY - Math.min(22, gapPx * 0.3),
    mOutY: 886,
    lensY: 934,
    ccd: { x: down.cx - 80, y: 982, w: 160, h: 26 },
    rowY,
    planeY: (g) => rowY((g + 1) * S),
    hit: (x, y) => {
      if (y < couplerInY || y > couplerOutY) return null
      const row = Math.round(((y - couplerInY) / span) * (rows - 1))
      if (x >= down.x && x <= down.x + down.w) return { lane: 'down', row }
      if (x >= up.x && x <= up.x + up.w) return { lane: 'up', row }
      return null
    },
  }
}
