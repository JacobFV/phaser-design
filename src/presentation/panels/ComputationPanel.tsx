import { useState } from 'react'
import type { ComputationConfig } from '../../core/computation/regions'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { FieldImage } from '../components/FieldImage'
import { Row } from '../components/inputs'
import { newPort, newRegion, portFields, regionFields } from '../forms/computationSchemas'
import { SchemaForm } from '../forms/SchemaForm'

interface Props {
  computation: ComputationConfig
  snapshot: SimulationSnapshot | null
  onChange: (c: ComputationConfig) => void
  onWritePort: (port: string, values: number[], mode: 'pulse' | 'continuous') => void
}

/** Regions, encodings and ports: the semantic interpretation of the field, independent of any algorithm. */
export function ComputationPanel({ computation: c, snapshot, onChange, onWritePort }: Props) {
  const [regionSel, setRegionSel] = useState<string | null>(c.regions[0]?.id ?? null)
  const [portSel, setPortSel] = useState<string | null>(null)
  const region = c.regions.find((r) => r.id === regionSel) ?? null
  const port = c.ports.find((p) => p.id === portSel) ?? null
  const regionIds = c.regions.map((r) => r.id)
  const uniqueId = (base: string, taken: string[]) => {
    let n = 1
    while (taken.includes(`${base}${n}`)) n++
    return `${base}${n}`
  }

  return (
    <div className="panel computation">
      <section>
        <h3>regions</h3>
        <p className="hint">A region is a patch of the transverse plane split into cells; its encoding maps light to numbers.</p>
        <div className="element-list">
          {c.regions.map((r) => (
            <button key={r.id} className={`element-item ${r.id === regionSel ? 'active' : ''}`} onClick={() => setRegionSel(r.id === regionSel ? null : r.id)}>
              <span className="el-id">{r.id}</span>
              <span className="el-kind">{r.encoding.kind} · {r.cells.x}×{r.cells.y}</span>
              <span className="el-visits">{snapshot ? `${((snapshot.computation.regionPower[r.id] ?? 0) * 100).toFixed(1)} % of power` : ''}</span>
            </button>
          ))}
        </div>
        <button className="small" onClick={() => { const id = uniqueId('region', regionIds); onChange({ ...c, regions: [...c.regions, newRegion(id)] }); setRegionSel(id) }}>+ add region</button>
        {region && (
          <div className="element-editor">
            <SchemaForm value={region} fields={regionFields} onChange={(next) => onChange({ ...c, regions: c.regions.map((r) => (r.id === region.id ? next : r)) })} />
            <button className="small danger" onClick={() => { onChange({ regions: c.regions.filter((r) => r.id !== region.id), ports: c.ports.filter((p) => p.region !== region.id) }); setRegionSel(null) }}>
              remove region (and its ports)
            </button>
          </div>
        )}
      </section>

      <section>
        <h3>ports</h3>
        <div className="element-list">
          {c.ports.map((p) => (
            <button key={p.id} className={`element-item ${p.id === portSel ? 'active' : ''}`} onClick={() => setPortSel(p.id === portSel ? null : p.id)}>
              <span className="el-id">{p.id}</span>
              <span className="el-kind">{p.direction} · {p.region}</span>
              <span className="el-visits">{p.direction === 'input' ? `→ ${p.physicalPort}` : p.source.kind === 'cavity' ? 'circulating field' : `${p.source.kind} ${'tap' in p.source ? p.source.tap : p.source.readout}`}</span>
            </button>
          ))}
        </div>
        <button className="small" disabled={!regionIds.length} onClick={() => { const id = uniqueId('port', c.ports.map((p) => p.id)); onChange({ ...c, ports: [...c.ports, newPort(id, regionIds[0])] }); setPortSel(id) }}>+ add port</button>
        {port && (
          <div className="element-editor">
            <SchemaForm value={port} fields={portFields(regionIds)} onChange={(next) => onChange({ ...c, ports: c.ports.map((p) => (p.id === port.id ? { ...next, id: port.id } : p)) })} />
            {port.direction === 'input' && (
              <Row label="test injection">
                <button className="small" onClick={() => onWritePort(port.id, Array(dims(c, port.region)).fill(1), 'pulse')}>uniform pulse</button>
              </Row>
            )}
            <button className="small danger" onClick={() => { onChange({ ...c, ports: c.ports.filter((p) => p.id !== port.id) }); setPortSel(null) }}>remove port</button>
          </div>
        )}
      </section>

      {snapshot && (
        <section>
          <h3>live output ports</h3>
          {Object.entries(snapshot.computation.ports).map(([id, values]) => {
            const r = c.regions.find((x) => x.id === c.ports.find((p) => p.id === id)?.region)
            if (!r) return null
            const grid = r.encoding.kind !== 'complex' && values.length === r.cells.x * r.cells.y
            return (
              <div key={id} className="port-view">
                <div className="row-label">{id} <span className="dim">({r.encoding.kind})</span></div>
                {grid ? <FieldImage data={values.map((v) => (r.encoding.kind === 'phase' || r.encoding.kind === 'differential-intensity' ? (v + Math.PI) : Math.abs(v)))} nx={r.cells.x} ny={r.cells.y} intensity mode="intensity" size={120} /> : <span className="readonly">{values.length} values</span>}
              </div>
            )
          })}
          {snapshot.computation.warnings.map((w, i) => <p key={i} className="warning-text">{w}</p>)}
        </section>
      )}
    </div>
  )
}

function dims(c: ComputationConfig, regionId: string) {
  const r = c.regions.find((x) => x.id === regionId)
  return r ? r.cells.x * r.cells.y * (r.encoding.kind === 'complex' ? 2 : 1) : 0
}
