import { useState } from 'react'
import { FractionInput, NumberInput, Row, Select } from '../components/inputs'
import { getAt, setAt, type FieldDescriptor, type Path } from './schema'

interface Props<T> {
  value: T
  fields: FieldDescriptor[]
  onChange: (next: T) => void
}

/** Renders a descriptor list against a value. Every edit produces a new immutable value. */
export function SchemaForm<T>({ value, fields, onChange }: Props<T>) {
  const set = (path: Path, v: unknown) => onChange(setAt(value, path, v))
  return <div className="schema-form">{fields.map((f, i) => <FieldView key={i} f={f} value={value} set={set} />)}</div>
}

function FieldView({ f, value, set }: { f: FieldDescriptor; value: unknown; set: (path: Path, v: unknown) => void }) {
  switch (f.kind) {
    case 'number': {
      const scale = f.unit?.scale ?? 1
      const v = Number(getAt(value, f.path))
      return (
        <Row label={f.label} hint={f.hint}>
          <NumberInput value={v * scale} min={f.min !== undefined ? f.min * scale : undefined} max={f.max !== undefined ? f.max * scale : undefined} onCommit={(x) => set(f.path, x / scale)} />
          {f.unit?.label && <span className="unit">{f.unit.label}</span>}
        </Row>
      )
    }
    case 'fraction':
      return <Row label={f.label} hint={f.hint}><FractionInput value={Number(getAt(value, f.path))} onCommit={(x) => set(f.path, x)} /></Row>
    case 'integer':
      return (
        <Row label={f.label} hint={f.hint}>
          <NumberInput value={Number(getAt(value, f.path))} min={f.min} max={f.max} onCommit={(x) => set(f.path, Math.round(x))} />
        </Row>
      )
    case 'boolean':
      return (
        <Row label={f.label}>
          <input type="checkbox" checked={Boolean(getAt(value, f.path))} onChange={(e) => set(f.path, e.target.checked)} />
        </Row>
      )
    case 'select':
      return <Row label={f.label}><Select value={String(getAt(value, f.path))} options={f.options} onChange={(x) => set(f.path, x)} /></Row>
    case 'text':
      return (
        <Row label={f.label}>
          <input className="text" value={String(getAt(value, f.path) ?? '')} onChange={(e) => set(f.path, e.target.value)} />
        </Row>
      )
    case 'directional':
      return <DirectionalView f={f} value={value} set={set} />
    case 'vec2': {
      const v = getAt(value, f.path) as { x: number; y: number }
      return (
        <Row label={f.label}>
          <NumberInput value={v.x * f.unit.scale} width={64} onCommit={(x) => set([...f.path, 'x'], x / f.unit.scale)} />
          <NumberInput value={v.y * f.unit.scale} width={64} onCommit={(y) => set([...f.path, 'y'], y / f.unit.scale)} />
          <span className="unit">{f.unit.label}</span>
        </Row>
      )
    }
    case 'union': {
      const u = getAt(value, f.path) as Record<string, unknown>
      const key = String(u?.[f.discriminant])
      const variant = f.variants[key]
      return (
        <div className="union">
          <Row label={f.label}>
            <Select
              value={key}
              options={Object.entries(f.variants).map(([k, v]) => ({ value: k, label: v.label }))}
              onChange={(k) => set(f.path, f.variants[k].template())}
            />
          </Row>
          {variant && variant.fields.length > 0 && (
            <div className="union-body">
              {variant.fields.map((vf, i) => <FieldView key={i} f={vf} value={u} set={(p, x) => set([...f.path, ...p], x)} />)}
            </div>
          )}
        </div>
      )
    }
    case 'group':
      return <Group f={f} value={value} set={set} />
    case 'custom':
      return <div className="custom-field"><div className="row-label">{f.label}</div>{f.render(value, set)}</div>
  }
}

function Group({ f, value, set }: { f: Extract<FieldDescriptor, { kind: 'group' }>; value: unknown; set: (path: Path, v: unknown) => void }) {
  const [open, setOpen] = useState(!f.collapsed)
  return (
    <fieldset className="group">
      <legend><button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {f.label}</button></legend>
      {open && f.fields.map((sub, i) => <FieldView key={i} f={sub} value={value} set={set} />)}
    </fieldset>
  )
}

/** Front/back power fractions with an explicit "same on both faces" link. */
function DirectionalView({ f, value, set }: { f: Extract<FieldDescriptor, { kind: 'directional' }>; value: unknown; set: (path: Path, v: unknown) => void }) {
  const d = getAt(value, f.path) as { front: number; back: number }
  const [linked, setLinked] = useState(d.front === d.back)
  return (
    <div className="directional">
      <Row label={f.label} hint={f.hint}>
        <label className="link-toggle"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> same both faces</label>
      </Row>
      <Row label="  front">
        <FractionInput value={d.front} onCommit={(x) => set(f.path, linked ? { front: x, back: x } : { ...d, front: x })} />
      </Row>
      {!linked && (
        <Row label="  back">
          <FractionInput value={d.back} onCommit={(x) => set(f.path, { ...d, back: x })} />
        </Row>
      )}
    </div>
  )
}
