import { resolveParams, type AlgorithmModule, type ParamDescriptor } from '../../core/algorithms/interfaces'
import type { ComputationConfig } from '../../core/computation/regions'
import type { AlgorithmConfig } from '../../core/runtime/config'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { FieldImage } from '../components/FieldImage'
import { formatValue } from '../components/format'
import { Row, Select } from '../components/inputs'
import { LinePlot } from '../components/Plots'
import { SchemaForm } from '../forms/SchemaForm'
import type { FieldDescriptor } from '../forms/schema'

interface Props {
  algorithm: AlgorithmConfig
  modules: AlgorithmModule<unknown>[]
  computation: ComputationConfig
  snapshot: SimulationSnapshot | null
  onChange: (a: AlgorithmConfig) => void
  onRestart: () => void
}

/** Module parameter descriptors → form descriptors. Modules stay UI-agnostic; this panel adapts them. */
const toField = (p: ParamDescriptor): FieldDescriptor => {
  const path = ['params', p.key]
  switch (p.kind) {
    case 'number': return { kind: 'number', path, label: p.label, min: p.min, max: p.max }
    case 'integer': return { kind: 'integer', path, label: p.label, min: p.min, max: p.max }
    case 'boolean': return { kind: 'boolean', path, label: p.label }
    case 'select': return { kind: 'select', path, label: p.label, options: p.options }
    case 'text': return { kind: 'text', path, label: p.label }
  }
}

export function AlgorithmPanel({ algorithm, modules, computation, snapshot, onChange, onRestart }: Props) {
  const module = modules.find((m) => m.id === algorithm.module) ?? null
  const params = module ? resolveParams(module, algorithm.params) : {}
  const req = module ? module.requirements(params) : null
  const a = snapshot?.algorithm

  return (
    <div className="panel algorithm">
      <section>
        <h3>workload</h3>
        <Row label="module">
          <Select
            value={algorithm.module}
            options={[{ value: 'none', label: 'none (free physics)' }, ...modules.map((m) => ({ value: m.id, label: m.name }))]}
            onChange={(id) => onChange({ module: id, params: {} })}
          />
        </Row>
        {module && <p className="hint">{module.description}</p>}
        {module && (
          <SchemaForm value={{ ...algorithm, params }} fields={module.params.map(toField)} onChange={(next) => onChange({ module: algorithm.module, params: next.params })} />
        )}
        {module && <button className="small" onClick={onRestart}>restart algorithm (keeps optical field)</button>}
      </section>

      {req && (
        <section>
          <h3>requirements</h3>
          <p className="hint">Algorithms bind to computational ports, never to optical elements. Cadence: every {module!.cadence(params) >= Number.MAX_SAFE_INTEGER ? '∞ (no updates)' : `${module!.cadence(params)} cycles`}.</p>
          <ul className="requirements">
            {req.ports.map((p) => {
              const port = computation.ports.find((x) => x.id === p.id)
              const ok = port?.direction === p.direction
              return <li key={p.id} className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '✗'} {p.direction} port <b>{p.id}</b>{port ? ` → region ${port.region}` : ' missing'}</li>
            })}
            {req.regions.map((r) => <li key={r} className={computation.regions.some((x) => x.id === r) ? 'ok' : 'bad'}>region {r}</li>)}
          </ul>
        </section>
      )}

      {a && module && (
        <section>
          <h3>state &amp; readout</h3>
          <Row label="status"><span className={a.status.done ? 'readonly ok' : 'readonly'}>{a.status.phase}</span></Row>
          {a.error && <p className="error-text">{a.error}</p>}
          <table className="metrics-table">
            <tbody>
              {Object.entries(a.readout.metrics).map(([k, v]) => <tr key={k}><td>{k}</td><td>{formatValue(v)}</td></tr>)}
            </tbody>
          </table>
          {a.readout.grid && (
            <div className="port-view">
              <div className="row-label">{a.readout.grid.label}</div>
              <FieldImage data={a.readout.grid.values} nx={a.readout.grid.width} ny={a.readout.grid.height} intensity mode="intensity" size={140} />
            </div>
          )}
          {Object.entries(a.readout.vectors ?? {}).map(([k, v]) => v.length > 1 && (
            <div key={k} className="port-view">
              <div className="row-label">{k}</div>
              <LinePlot series={[{ values: v }]} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
