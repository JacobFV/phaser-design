import type { PositionedElement, TopologySpec } from '../../core/physics/topology/topology'
import { NumberInput, Row, Select, Unit } from '../components/inputs'
import { mediumField } from '../forms/commonSchemas'
import { SchemaForm } from '../forms/SchemaForm'
import { U } from '../forms/schema'

interface Props {
  topology: TopologySpec
  elementIds: string[]
  onChange: (t: TopologySpec) => void
}

const mm = U.mm

/** Every element the topology already places. A physical element sits in exactly one place, so these are excluded from pickers. */
function placedIds(t: TopologySpec): string[] {
  switch (t.kind) {
    case 'ring': return t.legs.flatMap((l) => [...l.items.map((i) => i.elementId), ...(l.corner ? [l.corner] : [])])
    case 'linear-reciprocal': return [...t.start.elementIds, ...t.end.elementIds, ...t.items.map((i) => i.elementId)]
    case 'custom': return [] // a custom route may legitimately revisit an element
  }
}

/** Midpoint of the widest empty stretch of [0, max] given the occupied positions. */
function widestGapMidpoint(positions: number[], max: number): number {
  const pts = [0, ...positions.filter((p) => p > 0 && p < max).sort((a, b) => a - b), max]
  let best = 0, at = max / 2
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1]
    if (gap > best) { best = gap; at = (pts[i] + pts[i - 1]) / 2 }
  }
  return at
}

/** Kind-specific topology controls. Switching kind is explicit and handled by the parent. */
export function TopologyEditor({ topology: t, elementIds, onChange }: Props) {
  const placed = placedIds(t)
  const free = elementIds.filter((id) => !placed.includes(id))
  // options for a picker: its current element plus everything not yet placed anywhere
  const optionsFor = (current?: string) => [...(current ? [current] : []), ...free].map((id) => ({ value: id, label: id }))

  /**
   * Elements along one axis, always shown in physical order. Editing a position re-sorts the list, so what you see
   * is exactly the order the beam meets them. Each element can be placed once.
   */
  const Placement = ({ items, max, set }: { items: PositionedElement[]; max: number; set: (items: PositionedElement[]) => void }) => {
    const ordered = items.map((it, k) => ({ it, k })).sort((a, b) => a.it.position - b.it.position || a.k - b.k)
    const update = (k: number, patch: Partial<PositionedElement>) => set(items.map((x, i) => (i === k ? { ...x, ...patch } : x)))
    return (
      <div className="items">
        {ordered.map(({ it, k }, order) => (
          <div key={k} className="item-row placement">
            <span className="step-no">{order + 1}</span>
            <Select value={it.elementId} options={optionsFor(it.elementId)} onChange={(elementId) => update(k, { elementId })} />
            <span className="unit">at</span>
            <NumberInput value={it.position * mm.scale} min={0} max={max * mm.scale} width={64} onCommit={(v) => update(k, { position: v / mm.scale })} />
            <span className="unit">mm</span>
            <button className="icon" title="remove from the route" onClick={() => set(items.filter((_, i) => i !== k))}>×</button>
          </div>
        ))}
        <div className="button-row">
          <button className="small" disabled={!free.length} title={free.length ? `place ${free[0]}` : 'every element is already placed'}
            onClick={() => set([...items, { elementId: free[0], position: widestGapMidpoint(items.map((i) => i.position), max) }])}>
            + place element
          </button>
          {!free.length && elementIds.length > 0 && <span className="hint">all elements placed</span>}
        </div>
      </div>
    )
  }

  switch (t.kind) {
    case 'ring':
      return (
        <div className="topology ring">
          <p className="hint">Closed unidirectional route; every element is entered from its front face. Round-trip length is the sum of all legs.</p>
          {t.legs.map((leg, li) => {
            const setLeg = (patch: Partial<typeof leg>) => onChange({ ...t, legs: t.legs.map((l, k) => (k === li ? { ...l, ...patch } : l)) })
            return (
              <fieldset key={leg.id} className="group">
                <legend>{leg.label ?? leg.id}</legend>
                <Row label="length"><NumberInput value={leg.length * mm.scale} min={0} onCommit={(v) => setLeg({ length: v / mm.scale })} /><Unit label="mm" /></Row>
                <Row label="corner element">
                  <Select value={leg.corner ?? ''} options={[{ value: '', label: '(none)' }, ...optionsFor(leg.corner)]} onChange={(corner) => setLeg({ corner: corner || undefined })} />
                </Row>
                <SchemaForm value={leg} fields={[mediumField(['medium'])]} onChange={(l) => setLeg({ medium: l.medium })} />
                <Placement items={leg.items} max={leg.length} set={(items) => setLeg({ items })} />
              </fieldset>
            )
          })}
          {t.legs.length === 4 && (
            <button className="small" onClick={() => onChange({ ...t, legs: t.legs.map((l, k) => (k === 3 ? { ...l, length: t.legs[1].length } : l)) })}>
              make left leg = right leg
            </button>
          )}
        </div>
      )
    case 'linear-reciprocal': {
      const chips = (ids: string[], set: (ids: string[]) => void) => (
        <span className="chips">
          {ids.map((id, i) => <button key={i} className="chip" title="remove" onClick={() => set(ids.filter((_, k) => k !== i))}>{id} ×</button>)}
          {free.length > 0 && <Select value="" options={[{ value: '', label: '+ add' }, ...optionsFor()]} onChange={(id) => id && set([...ids, id])} />}
          {!ids.length && !free.length && <span className="hint">none</span>}
        </span>
      )
      return (
        <div className="topology linear">
          <p className="hint">Forward pass enters items from the front, the return pass from the back. Round trip = 2 × length.</p>
          <Row label="mirror spacing $L$"><NumberInput value={t.length * mm.scale} min={0} onCommit={(v) => onChange({ ...t, length: v / mm.scale })} /><Unit label="mm" /></Row>
          <SchemaForm value={t} fields={[mediumField(['medium'])]} onChange={(n) => onChange({ ...t, medium: n.medium })} />
          <Row label="start assembly">{chips(t.start.elementIds, (elementIds) => onChange({ ...t, start: { elementIds } }))}</Row>
          <Row label="end assembly">{chips(t.end.elementIds, (elementIds) => onChange({ ...t, end: { elementIds } }))}</Row>
          <h4>along the axis, from the start mirror</h4>
          <Placement items={t.items} max={t.length} set={(items) => onChange({ ...t, items })} />
          {t.items.length > 1 && (
            <button className="small" onClick={() => {
              const ordered = [...t.items].sort((a, b) => a.position - b.position)
              onChange({ ...t, items: ordered.map((it, i) => ({ ...it, position: ((i + 1) * t.length) / (ordered.length + 1) })) })
            }}>
              space evenly
            </button>
          )}
        </div>
      )
    }
    case 'custom':
      return (
        <div className="topology custom">
          <p className="hint">Explicit ordered route. Each element visit names its incident face.</p>
          {t.route.map((item, i) => {
            const set = (next: typeof item) => onChange({ ...t, route: t.route.map((x, k) => (k === i ? next : x)) })
            const move = (dir: -1 | 1) => {
              const r = [...t.route]
              const j = i + dir
              if (j < 0 || j >= r.length) return
              ;[r[i], r[j]] = [r[j], r[i]]
              onChange({ ...t, route: r })
            }
            const idOptions = elementIds.map((id) => ({ value: id, label: id }))
            return (
              <div key={i} className="item-row">
                <span className="step-no">{i + 1}</span>
                {item.kind === 'element' ? (
                  <>
                    <Select value={item.elementId} options={idOptions} onChange={(elementId) => set({ ...item, elementId })} />
                    <Select value={item.side} options={[{ value: 'front', label: 'front' }, { value: 'back', label: 'back' }]} onChange={(side) => set({ ...item, side })} />
                  </>
                ) : (
                  <>
                    <span className="unit">propagate</span>
                    <NumberInput value={item.length * mm.scale} min={0} width={64} onCommit={(v) => set({ ...item, length: v / mm.scale })} />
                    <span className="unit">mm</span>
                  </>
                )}
                <button className="icon" onClick={() => move(-1)}>↑</button>
                <button className="icon" onClick={() => move(1)}>↓</button>
                <button className="icon" onClick={() => onChange({ ...t, route: t.route.filter((_, k) => k !== i) })}>×</button>
              </div>
            )
          })}
          <div className="button-row">
            <button className="small" onClick={() => onChange({ ...t, route: [...t.route, { kind: 'propagate', length: 0.01, medium: { kind: 'vacuum' } }] })}>+ propagation</button>
            <button className="small" disabled={!elementIds.length} onClick={() => onChange({ ...t, route: [...t.route, { kind: 'element', elementId: elementIds[0], side: 'front' }] })}>+ element visit</button>
          </div>
        </div>
      )
  }
}
