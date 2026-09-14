import type { PositionedElement, TopologySpec } from '../../core/physics/topology/topology'
import { NumberInput, Row, Select } from '../components/inputs'
import { mediumField } from '../forms/commonSchemas'
import { SchemaForm } from '../forms/SchemaForm'
import { U } from '../forms/schema'

interface Props {
  topology: TopologySpec
  elementIds: string[]
  onChange: (t: TopologySpec) => void
}

const mm = U.mm

/** Kind-specific topology controls. Switching kind is explicit and handled by the parent. */
export function TopologyEditor({ topology: t, elementIds, onChange }: Props) {
  const idOptions = elementIds.map((id) => ({ value: id, label: id }))

  const Items = ({ items, max, set }: { items: PositionedElement[]; max: number; set: (items: PositionedElement[]) => void }) => (
    <div className="items">
      {items.map((it, i) => (
        <div key={i} className="item-row">
          <Select value={it.elementId} options={idOptions} onChange={(elementId) => set(items.map((x, k) => (k === i ? { ...x, elementId } : x)))} />
          <span className="unit">at</span>
          <NumberInput value={it.position * mm.scale} min={0} max={max * mm.scale} width={64} onCommit={(v) => set(items.map((x, k) => (k === i ? { ...x, position: v / mm.scale } : x)))} />
          <span className="unit">mm</span>
          <button className="icon" title="remove" onClick={() => set(items.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button className="small" onClick={() => set([...items, { elementId: elementIds[0], position: max / 2 }])} disabled={!elementIds.length}>+ place element</button>
    </div>
  )

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
                <Row label="length"><NumberInput value={leg.length * mm.scale} min={0} onCommit={(v) => setLeg({ length: v / mm.scale })} /><span className="unit">mm</span></Row>
                <Row label="corner element">
                  <Select value={leg.corner ?? ''} options={[{ value: '', label: '(none)' }, ...idOptions]} onChange={(corner) => setLeg({ corner: corner || undefined })} />
                </Row>
                <SchemaForm value={leg} fields={[mediumField(['medium'])]} onChange={(l) => setLeg({ medium: l.medium })} />
                <Items items={leg.items} max={leg.length} set={(items) => setLeg({ items })} />
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
          <Select value="" options={[{ value: '', label: '+ add' }, ...idOptions]} onChange={(id) => id && set([...ids, id])} />
        </span>
      )
      return (
        <div className="topology linear">
          <p className="hint">Forward pass enters items from the front, the return pass from the back. Round trip = 2 × length.</p>
          <Row label="mirror spacing"><NumberInput value={t.length * mm.scale} min={0} onCommit={(v) => onChange({ ...t, length: v / mm.scale })} /><span className="unit">mm</span></Row>
          <SchemaForm value={t} fields={[mediumField(['medium'])]} onChange={(n) => onChange({ ...t, medium: n.medium })} />
          <Row label="start assembly">{chips(t.start.elementIds, (elementIds) => onChange({ ...t, start: { elementIds } }))}</Row>
          <Row label="end assembly">{chips(t.end.elementIds, (elementIds) => onChange({ ...t, end: { elementIds } }))}</Row>
          <Items items={t.items} max={t.length} set={(items) => onChange({ ...t, items })} />
          <button className="small" onClick={() => onChange({ ...t, items: t.items.map((it, i) => ({ ...it, position: ((i + 1) * t.length) / (t.items.length + 1) })) })}>
            space items evenly
          </button>
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
          <button className="small" onClick={() => onChange({ ...t, route: [...t.route, { kind: 'propagate', length: 0.01, medium: { kind: 'vacuum' } }] })}>+ propagation</button>
          <button className="small" disabled={!elementIds.length} onClick={() => onChange({ ...t, route: [...t.route, { kind: 'element', elementId: elementIds[0], side: 'front' }] })}>+ element visit</button>
        </div>
      )
  }
}
