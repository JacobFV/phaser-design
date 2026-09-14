import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface Note {
  id: string
  anchor: { x: number; y: number } // viewBox coordinates of the renderer
  title: ReactNode
  body: ReactNode
  kind?: 'annotation' | 'slice'
}

interface Props {
  vbW: number
  vbH: number
  left: Note[]
  right: Note[]
  children: ReactNode
  onNoteClick?: (id: string) => void
}

const GAP = 40
const CARD_GAP = 10
const TITLE_OFFSET = 13

/** Renderer in the middle, notes in both margins placed near their anchors, with leader lines. */
export function Stage({ vbW, vbH, left, right, children, onNoteClick }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const [W, setW] = useState(1200)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [hover, setHover] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    let changed = false
    cardEls.current.forEach((el, id) => {
      next[id] = el.offsetHeight
      if (heights[id] !== next[id]) changed = true
    })
    if (changed || Object.keys(next).length !== Object.keys(heights).length) setHeights(next)
  })

  const narrow = W < 900
  const simW = narrow ? Math.min(W, 560) : Math.min(560, W - 220 - 250 - 2 * GAP)
  const spare = W - simW - 2 * GAP
  const colL = narrow ? 0 : Math.min(300, spare * 0.46)
  const colR = narrow ? 0 : Math.min(320, spare - colL)
  const ox = narrow ? 0 : (W - (colL + colR + simW + 2 * GAP)) / 2
  const s = simW / vbW
  const simH = vbH * s
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

  const card = (n: Note, style?: React.CSSProperties, index?: number) => (
    <div key={n.id} ref={register(n.id)} className={`note ${n.kind ?? 'annotation'} ${hover === n.id ? 'hover' : ''}`} style={style}
      onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => onNoteClick?.(n.id)}>
      <div className="note-title">
        {index !== undefined && <span className="badge-num">{index}</span>}
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
          <svg className="leaders" viewBox={`0 0 ${vbW} ${vbH}`}>
            {all.map((n, i) => (
              <g key={n.id} transform={`translate(${n.anchor.x},${n.anchor.y})`}>
                <circle r={7} className="badge-dot" />
                <text y={3} textAnchor="middle" className="badge-text">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className="narrow-notes">{all.map((n, i) => card(n, undefined, i + 1))}</div>
      </div>
    )
  }

  const lt = place(left)
  const rt = place(right)
  const colHeight = (notes: Note[], tops: Map<string, number>) => Math.max(0, ...notes.map((n) => tops.get(n.id)! + (heights[n.id] ?? 80)))
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
      <div className="stage-col" style={{ left: ox, width: colL }}>{left.map((n) => card(n, { top: lt.get(n.id) }))}</div>
      <div className="stage-sim" style={{ left: simX, width: simW }}>{children}</div>
      <div className="stage-col" style={{ left: simX + simW + GAP, width: colR }}>{right.map((n) => card(n, { top: rt.get(n.id) }))}</div>
      <svg className="leaders" width={W} height={H}>
        {left.map((n) => leader(n, lt.get(n.id)!, 'l'))}
        {right.map((n) => leader(n, rt.get(n.id)!, 'r'))}
      </svg>
    </div>
  )
}
