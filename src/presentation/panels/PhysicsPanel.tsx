import { useRef, useState } from 'react'
import { isProgrammable, withProgram, type AssetRef, type ElementKind, type OpticalElementSpec } from '../../core/physics/elements/types'
import type { DetectorSpec, PhysicsConfig } from '../../core/physics/system'
import { rectangularRing } from '../../core/physics/topology/builders'
import { compileRoute, type TopologySpec } from '../../core/physics/topology/topology'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { NumberInput, Row, Select, Unit } from '../components/inputs'
import { ELEMENT_KINDS, kindInfo } from '../forms/elementSchemas'
import { SchemaForm } from '../forms/SchemaForm'
import { U, type FieldDescriptor } from '../forms/schema'
import { TopologyEditor } from './TopologyEditor'

interface Props {
  physics: PhysicsConfig
  snapshot: SimulationSnapshot | null
  selected: string | null
  onSelect: (id: string | null) => void
  onChange: (physics: PhysicsConfig) => void
  putAsset: (id: string, width: number, height: number, data: Float64Array) => Promise<AssetRef>
}

const POW2 = [32, 64, 128, 256, 512].map((n) => ({ value: String(n), label: String(n) }))

const boundaryField: FieldDescriptor = {
  kind: 'union', path: ['boundary'], label: 'transverse boundary', discriminant: 'kind',
  variants: {
    absorbing: { label: 'absorbing edge', template: () => ({ kind: 'absorbing', widthFraction: 0.06 }), fields: [{ kind: 'number', path: ['widthFraction'], label: 'absorber width (fraction)', min: 0.01, max: 0.45 }] },
    periodic: { label: 'periodic (idealised)', template: () => ({ kind: 'periodic' }), fields: [] },
  },
}

const detectorField: FieldDescriptor = {
  kind: 'union', path: ['detector'], label: 'detector', discriminant: 'kind',
  variants: {
    'near-field': { label: 'near field', template: () => ({ kind: 'near-field' }), fields: [] },
    'fourier-plane': { label: 'Fourier plane (ideal lens)', template: () => ({ kind: 'fourier-plane', focalLength: 0.05 }), fields: [{ kind: 'number', path: ['focalLength'], label: 'focal length', unit: U.mm }] },
  },
}

/** Convert between topology kinds, keeping the existing elements. Explicit, lossy where kinds differ. */
function convertTopology(kind: TopologySpec['kind'], physics: PhysicsConfig): TopologySpec {
  const route = compileRoute(physics.topology)
  const visited = [...new Set(route.steps.flatMap((s) => (s.kind === 'element' ? [s.elementId] : [])))]
  const ids = visited.length ? visited : physics.elements.map((e) => e.id)
  const reflectors = ids.filter((id) => ['mirror', 'coupler', 'lcos-slm'].includes(physics.elements.find((e) => e.id === id)!.kind))
  const others = ids.filter((id) => !reflectors.includes(id))
  const medium = { kind: 'vacuum' } as const
  const L = Math.max(route.geometricLength / 2, 0.02)
  switch (kind) {
    case 'linear-reciprocal':
      return {
        kind, length: L, medium, start: { elementIds: reflectors.slice(0, 1) }, end: { elementIds: reflectors.slice(1, 2) },
        items: others.map((elementId, i) => ({ elementId, position: ((i + 1) * L) / (others.length + 1) })),
      }
    case 'ring': {
      const corners = [0, 1, 2, 3].map((i) => reflectors[i] ?? '') as [string, string, string, string]
      const ring = rectangularRing({ width: L / 4, height: L, medium, corners, items: { right: others.map((elementId, i) => ({ elementId, position: ((i + 1) * L) / (others.length + 1) })) } })
      return { ...ring, legs: ring.legs.map((l) => ({ ...l, corner: l.corner || undefined })) }
    }
    case 'custom':
      return { kind, route: route.steps.map((s) => (s.kind === 'element' ? { kind: 'element', elementId: s.elementId, side: s.side } : { kind: 'propagate', length: s.length, medium: s.medium })) }
  }
}

/** Remove every topology reference to an element. */
function withoutElement(t: TopologySpec, id: string): TopologySpec {
  switch (t.kind) {
    case 'ring': return { ...t, legs: t.legs.map((l) => ({ ...l, corner: l.corner === id ? undefined : l.corner, items: l.items.filter((it) => it.elementId !== id) })) }
    case 'linear-reciprocal': return { ...t, start: { elementIds: t.start.elementIds.filter((x) => x !== id) }, end: { elementIds: t.end.elementIds.filter((x) => x !== id) }, items: t.items.filter((it) => it.elementId !== id) }
    case 'custom': return { ...t, route: t.route.filter((r) => r.kind !== 'element' || r.elementId !== id) }
  }
}

export function PhysicsPanel({ physics, snapshot, selected, onSelect, onChange, putAsset }: Props) {
  const [newKind, setNewKind] = useState<ElementKind>('transmissive-lcd')
  const fileRef = useRef<HTMLInputElement>(null)
  const [arrayError, setArrayError] = useState<string | null>(null)
  const set = (patch: Partial<PhysicsConfig>) => onChange({ ...physics, ...patch })
  const { grid } = physics.field
  const sel = physics.elements.find((e) => e.id === selected) ?? null
  const budget = snapshot?.physics.budget ?? []
  const visits = (id: string) => (snapshot?.physics.route.steps ?? []).filter((s) => s.kind === 'element' && s.elementId === id)

  const updateElement = (next: OpticalElementSpec) => set({ elements: physics.elements.map((e) => (e.id === next.id ? next : e)) })

  const addElement = () => {
    let n = 1
    const base = newKind.replace(/[^a-z]/g, '').slice(0, 6)
    while (physics.elements.some((e) => e.id === `${base}${n}`)) n++
    const id = `${base}${n}`
    set({ elements: [...physics.elements, kindInfo(newKind).template(id)] })
    onSelect(id)
  }

  const removeElement = (id: string) => {
    set({ elements: physics.elements.filter((e) => e.id !== id), topology: withoutElement(physics.topology, id) })
    onSelect(null)
  }

  const loadArray = async (file: File) => {
    if (!sel || !isProgrammable(sel)) return
    setArrayError(null)
    try {
      const px = sel.kind === 'lcd-microlens' ? sel.lcd.pixels : sel.pixels
      const parsed = JSON.parse(await file.text()) as number[] | number[][]
      const flat = (Array.isArray(parsed[0]) ? (parsed as number[][]).flat() : (parsed as number[])).map(Number)
      if (flat.length !== px.resolution.x * px.resolution.y) throw new Error(`expected ${px.resolution.x}×${px.resolution.y} = ${px.resolution.x * px.resolution.y} values, got ${flat.length}`)
      const ref = await putAsset(`${sel.id}:${file.name}`, px.resolution.x, px.resolution.y, Float64Array.from(flat))
      updateElement(withProgram(sel, { kind: 'array', ref }))
    } catch (e) {
      setArrayError((e as Error).message)
    }
  }

  return (
    <div className="panel physics">
      <section>
        <h3>field &amp; sampling</h3>
        <Row label="grid ($n_x \times n_y$)">
          <Select value={String(grid.nx)} options={POW2} onChange={(v) => set({ field: { ...physics.field, grid: { ...grid, nx: Number(v) } } })} />
          <Select value={String(grid.ny)} options={POW2} onChange={(v) => set({ field: { ...physics.field, grid: { ...grid, ny: Number(v) } } })} />
        </Row>
        <Row label="spacing $\Delta x, \Delta y$">
          <NumberInput value={grid.dx * 1e6} width={64} min={0.1} onCommit={(v) => set({ field: { ...physics.field, grid: { ...grid, dx: v * 1e-6 } } })} />
          <NumberInput value={grid.dy * 1e6} width={64} min={0.1} onCommit={(v) => set({ field: { ...physics.field, grid: { ...grid, dy: v * 1e-6 } } })} />
          <Unit label="µm" />
        </Row>
        <Row label="window"><span className="readonly">{(grid.nx * grid.dx * 1e3).toFixed(2)} × {(grid.ny * grid.dy * 1e3).toFixed(2)} mm</span></Row>
        <Row label="wavelength $\lambda$">
          <NumberInput value={physics.field.wavelength * 1e9} min={100} onCommit={(v) => set({ field: { ...physics.field, wavelength: v * 1e-9 } })} />
          <Unit label="nm" />
        </Row>
        <SchemaForm value={physics.field} fields={[boundaryField]} onChange={(field) => set({ field })} />
        <p className="hint">Changing the grid or wavelength resets the optical field; everything else keeps it.</p>
      </section>

      <section>
        <h3>topology</h3>
        <Row label="kind">
          <Select value={physics.topology.kind} options={[{ value: 'linear-reciprocal', label: 'linear reciprocal' }, { value: 'ring', label: 'ring' }, { value: 'custom', label: 'custom route' }]}
            onChange={(k) => k !== physics.topology.kind && set({ topology: convertTopology(k, physics) })} />
        </Row>
        <TopologyEditor topology={physics.topology} elementIds={physics.elements.map((e) => e.id)} onChange={(topology) => set({ topology })} />
      </section>

      <section>
        <h3>optical elements</h3>
        <div className="element-list">
          {physics.elements.map((e) => {
            const v = visits(e.id)
            const T = v.map((s) => budget[snapshot!.physics.route.steps.indexOf(s)]?.transmission)
            return (
              <button key={e.id} className={`element-item ${e.id === selected ? 'active' : ''}`} onClick={() => onSelect(e.id === selected ? null : e.id)}>
                <span className="el-id">{e.label ?? e.id}</span>
                <span className="el-kind">{kindInfo(e.kind).label}</span>
                <span className="el-visits">{v.length ? v.map((s, i) => `${s.kind === 'element' && s.side === 'front' ? 'F' : 'B'} ${T[i] !== undefined ? T[i]!.toFixed(3) : ''}`).join(' · ') : 'not on route'}</span>
              </button>
            )
          })}
        </div>
        <div className="item-row add-row">
          <Select value={newKind} options={ELEMENT_KINDS.map((k) => ({ value: k.kind, label: k.label }))} onChange={setNewKind} />
          <button className="small" onClick={addElement}>+ add</button>
        </div>
      </section>

      {sel && (
        <section className="element-editor">
          <h3>{sel.label ?? sel.id} <span className="dim">· {kindInfo(sel.kind).label}</span></h3>
          <p className="hint">{kindInfo(sel.kind).description}</p>
          <Row label="label"><input className="text" value={sel.label ?? ''} onChange={(e) => updateElement({ ...sel, label: e.target.value || undefined })} /></Row>
          <SchemaForm value={sel} fields={kindInfo(sel.kind).fields} onChange={updateElement} />
          {isProgrammable(sel) && (
            <div className="row-actions">
              <button className="small" onClick={() => fileRef.current?.click()}>load phase array (.json)…</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && loadArray(e.target.files[0])} />
              {arrayError && <p className="error-text">{arrayError}</p>}
            </div>
          )}
          <button className="small danger" onClick={() => removeElement(sel.id)}>remove element</button>
        </section>
      )}

      <section>
        <h3>readouts</h3>
        {physics.readouts.map((r, i) => (
          <fieldset key={r.id} className="group">
            <legend>{r.id}</legend>
            <Row label="tap id"><input className="text" value={r.tap} onChange={(e) => set({ readouts: physics.readouts.map((x, k) => (k === i ? { ...x, tap: e.target.value } : x)) })} /></Row>
            <SchemaForm value={r} fields={[detectorField]} onChange={(next) => set({ readouts: physics.readouts.map((x, k) => (k === i ? { ...x, detector: next.detector as DetectorSpec } : x)) })} />
            <Row label="stages"><span className="readonly">{r.stages.length ? r.stages.map((s) => (s.kind === 'element' ? s.element.label ?? s.element.id : `${(s.length * 1e3).toFixed(0)} mm`)).join(' → ') : 'none'}</span></Row>
          </fieldset>
        ))}
      </section>

      {snapshot && snapshot.physics.warnings.length > 0 && (
        <section>
          <h3>warnings</h3>
          <ul className="warnings">{snapshot.physics.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </section>
      )}
    </div>
  )
}
