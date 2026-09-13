import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Geometry } from '../layout'

export interface Note {
  id: string
  anchor: { x: number; y: number } // viewBox coordinates on the schematic
  title: ReactNode
  body: ReactNode
  kind?: 'annotation' | 'slice'
}

interface Props {
  g: Geometry
  left: Note[]
  right: Note[]
  children: ReactNode // the simulation
}

const GAP = 40
const CARD_GAP = 10
const TITLE_OFFSET = 13 // leader meets the card at its title baseline

/**
 * Tufte-style margins: the simulation in the centre, notes in both margins placed as close
 * to their anchor as collisions allow, with leader lines back to the schematic.
 */
export function Stage({ g, left, right, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const [W, setW] = useState(1280)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [hover, setHover] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // measure card heights after every render; only update state when something changed
  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    let changed = false
    cardEls.current.forEach((el, id) => {
      next[id] = el.offsetHeight
      if (heights[id] !== next[id]) changed = true
    })
    if (changed || Object.keys(next).length !== Object.keys(heights).length) setHeights(next)
  })

  const narrow = W < 1000
  const simW = narrow ? Math.min(W, 560) : Math.min(620, W - 250 - 280 - 2 * GAP)
  const spare = W - simW - 2 * GAP
  const colL = narrow ? 0 : Math.min(330, spare * 0.47)
  const colR = narrow ? 0 : Math.min(350, spare - colL)
  const ox = narrow ? 0 : (W - (colL + colR + simW + 2 * GAP)) / 2 // centre the whole spread
  const s = simW / g.vbW
  const simH = g.vbH * s
  const simX = ox + colL + GAP

  const place = (notes: Note[]) => {
    const sorted = [...notes].sort((a, b) => a.anchor.y - b.anchor.y)
    const tops = new Map<string, number>()
    let bottom = -Infinity
    for (const n of sorted) {
      const h = heights[n.id] ?? 80
      const top = Math.max(n.anchor.y * s - TITLE_OFFSET, bottom + CARD_GAP, 0)
      tops.set(n.id, top)
      bottom = top + h
    }
    // if we ran past the bottom of the simulation, push back up (but never into overlap)
    const needed = sorted.reduce((sum, n) => sum + (heights[n.id] ?? 80) + CARD_GAP, 0)
    let limit = Math.max(simH, needed)
    for (let i = sorted.length - 1; i >= 0; i--) {
      const n = sorted[i]
      const h = heights[n.id] ?? 80
      const top = Math.max(0, Math.min(tops.get(n.id)!, limit - h))
      tops.set(n.id, top)
      limit = top - CARD_GAP
    }
    return tops
  }

  const register = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardEls.current.set(id, el)
    else cardEls.current.delete(id)
  }

  const renderCard = (n: Note, style?: React.CSSProperties, index?: number) => (
    <div
      key={n.id}
      ref={register(n.id)}
      className={`note ${n.kind ?? 'annotation'} ${hover === n.id ? 'hover' : ''}`}
      style={style}
      onMouseEnter={() => setHover(n.id)}
      onMouseLeave={() => setHover(null)}
    >
      <div className="note-title">
        {index !== undefined && <span className="badge">{index}</span>}
        <span>{n.title}</span>
      </div>
      <div className="note-body">{n.body}</div>
    </div>
  )

  if (narrow) {
    const all = [...left, ...right]
    return (
      <div ref={wrap} className="stage narrow">
        <div className="stage-sim" style={{ position: 'relative', width: simW, margin: '0 auto' }}>
          {children}
          <svg className="leaders" viewBox={`0 0 ${g.vbW} ${g.vbH}`}>
            {all.map((n, i) => (
              <g key={n.id} transform={`translate(${n.anchor.x},${n.anchor.y})`}>
                <circle r={7} className="badge-dot" />
                <text y={3} textAnchor="middle" className="badge-text">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className="narrow-notes">{all.map((n, i) => renderCard(n, undefined, i + 1))}</div>
      </div>
    )
  }

  const lt = place(left)
  const rt = place(right)
  const colHeight = (notes: Note[], tops: Map<string, number>) =>
    Math.max(0, ...notes.map((n) => tops.get(n.id)! + (heights[n.id] ?? 80)))
  const H = Math.max(simH, colHeight(left, lt), colHeight(right, rt))

  const leader = (n: Note, top: number, side: 'l' | 'r') => {
    const ax = simX + n.anchor.x * s
    const ay = n.anchor.y * s
    const y = top + TITLE_OFFSET
    const ex = side === 'l' ? ox + colL : simX + simW + GAP
    const kx = side === 'l' ? ox + colL + GAP * 0.55 : simX + simW + GAP * 0.45
    return (
      <g key={n.id} className={`leader ${n.kind ?? 'annotation'} ${hover === n.id ? 'hover' : ''}`}>
        <path d={`M${ex},${y} L${kx},${y} L${ax},${ay}`} />
        <circle cx={ax} cy={ay} r={2.6} />
      </g>
    )
  }

  return (
    <div ref={wrap} className="stage" style={{ height: H }}>
      <div className="stage-col" style={{ left: ox, width: colL }}>
        {left.map((n) => renderCard(n, { top: lt.get(n.id) }))}
      </div>
      <div className="stage-sim" style={{ left: simX, width: simW }}>
        {children}
      </div>
      <div className="stage-col" style={{ left: simX + simW + GAP, width: colR }}>
        {right.map((n) => renderCard(n, { top: rt.get(n.id) }))}
      </div>
      <svg className="leaders" width={W} height={H}>
        {left.map((n) => leader(n, lt.get(n.id)!, 'l'))}
        {right.map((n) => leader(n, rt.get(n.id)!, 'r'))}
      </svg>
    </div>
  )
}
