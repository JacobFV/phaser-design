import { useState } from 'react'
import { DEFAULT_THRESHOLDS, type CharacterizationRequest, type StabilityThresholds } from '../../core/computation/analysis/characterize'
import type { Metric } from '../../core/physics/metrics/analytic'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { formatValue } from '../components/format'
import { Badge, NumberInput, Row, Unit } from '../components/inputs'
import { Rich, Tex } from '../components/Tex'
import { LinePlot, Sparkline } from '../components/Plots'
import type { CharacterizationJob } from '../hooks/useSimulation'

interface Props {
  metrics: Metric[]
  snapshot: SimulationSnapshot | null
  job: CharacterizationJob | null
  onCharacterize: (r: CharacterizationRequest) => void
}

const HORIZONS = [1, 10, 100, 1000, 10000]
const GROUPS: Metric['group'][] = ['timing', 'loss', 'diffraction', 'capacity', 'throughput', 'io']
const parseList = (s: string) => s.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0)

export function AnalysisPanel({ metrics, snapshot, job, onCharacterize }: Props) {
  const [sigmas, setSigmas] = useState('20, 40, 80, 160, 320')
  const [seps, setSeps] = useState('100, 200, 400, 800, 1600')
  const [horizons, setHorizons] = useState<number[]>([1, 10, 100])
  const [t, setT] = useState<StabilityThresholds>(DEFAULT_THRESHOLDS)
  const running = job !== null && !job.result
  const result = job?.result

  const energy = snapshot?.physics.energyHistory
  const measuredRetention = energy && energy.length > 2 ? energy[energy.length - 1] / energy[energy.length - 2] : null
  const analyticW = metrics.find((m) => m.key === 'minWaistOneTrip')

  return (
    <div className="panel analysis">
      <section>
        <h3>live numerical state <Badge kind="numerical" /></h3>
        <table className="metrics-table"><tbody>
          <tr><td>cycle</td><td>{snapshot?.cycle ?? 0}</td></tr>
          <tr><td>physical time</td><td>{formatValue(snapshot?.time ?? 0, 's')}</td></tr>
          <tr><td>mean intensity</td><td>{formatValue(snapshot?.physics.meanIntensity)}</td></tr>
          <tr><td>measured power ratio (last cycle)</td><td>{formatValue(measuredRetention)}</td></tr>
          {Object.entries(snapshot?.physics.elementStates ?? {}).map(([id, st]) => Object.entries(st).map(([k, v]) => (
            <tr key={id + k}><td>{id} {k}</td><td>{formatValue(v)}</td></tr>
          )))}
        </tbody></table>
        {energy && energy.length > 1 && <div className="spark-wrap"><Sparkline values={energy} window={400} /></div>}
      </section>

      {GROUPS.map((group) => {
        const ms = metrics.filter((m) => m.group === group)
        if (!ms.length) return null
        // one badge per section when every metric shares a kind; per-row badges only for the exceptions
        const counts = new Map<Metric['kind'], number>()
        for (const m of ms) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1)
        const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        return (
          <section key={group}>
            <h3>{group} <Badge kind={dominant} /></h3>
            <table className="metrics-table"><tbody>
              {ms.map((m) => (
                <tr key={m.key} title={m.note}>
                  <td><Rich>{m.label}</Rich>{m.note && <span className="note-mark">*</span>}</td>
                  <td>{formatValue(m.value, m.unit)}</td>
                  {m.kind !== dominant && <td><Badge kind={m.kind} /></td>}
                </tr>
              ))}
            </tbody></table>
          </section>
        )
      })}

      <section className="span">
        <h3>state characterisation</h3>
        <p className="hint">Launches Gaussian blobs into the current physics (no input, no algorithm) and measures how they evolve. Results are finite-horizon numerical statements, not proofs of infinite stability.</p>
        <Row label="blob $\sigma$ list"><input className="text wide" value={sigmas} onChange={(e) => setSigmas(e.target.value)} /><Unit label="µm" /></Row>
        <Row label="separations $d$"><input className="text wide" value={seps} onChange={(e) => setSeps(e.target.value)} /><Unit label="µm" /></Row>
        <Row label="horizons">
          <span className="chips">
            {HORIZONS.map((h) => (
              <label key={h} className="chip-check">
                <input type="checkbox" checked={horizons.includes(h)} onChange={(e) => setHorizons(e.target.checked ? [...horizons, h].sort((a, b) => a - b) : horizons.filter((x) => x !== h))} />
                {h}
              </label>
            ))}
          </span>
        </Row>
        <fieldset className="group">
          <legend>thresholds</legend>
          <Row label="min shape correlation $\rho$"><NumberInput value={t.minCorrelation} min={0} max={1} onCommit={(v) => setT({ ...t, minCorrelation: v })} /><Unit /></Row>
          <Row label="max leakage"><NumberInput value={t.maxLeakage} min={0} max={1} onCommit={(v) => setT({ ...t, maxLeakage: v })} /><Unit /></Row>
          <Row label="max cross-talk"><NumberInput value={t.maxCrosstalk} min={0} max={1} onCommit={(v) => setT({ ...t, maxCrosstalk: v })} /><Unit /></Row>
          <Row label="max $\sigma$ drift / cycle"><NumberInput value={t.maxWidthDriftPerCycle} min={0} onCommit={(v) => setT({ ...t, maxWidthDriftPerCycle: v })} /><Unit /></Row>
          <Row label="max centroid drift / cycle"><NumberInput value={t.maxCentroidDriftPerCycle} min={0} onCommit={(v) => setT({ ...t, maxCentroidDriftPerCycle: v })} /><Unit /></Row>
          <Row label="energy must be bounded">
            <input type="checkbox" checked={t.energy.kind === 'bounded'} onChange={(e) => setT({ ...t, energy: e.target.checked ? { kind: 'bounded', maxLogGrowthPerCycle: 0.01 } : { kind: 'ignore' } })} />
          </Row>
        </fieldset>
        <div className="button-row">
          <button className="primary" disabled={running || !horizons.length} onClick={() => onCharacterize({
            sigmas: parseList(sigmas).map((v) => v * 1e-6), separations: parseList(seps).map((v) => v * 1e-6), horizons, thresholds: t,
          })}>
            {running ? `Running… ${job!.done}/${job!.total}` : 'Run characterisation'}
          </button>
        </div>
        {running && <progress value={job!.done} max={job!.total} style={{ maxWidth: 640 }} />}
      </section>

      {result && (
        <section className="results span">
          <h3>results <Badge kind="numerical" /></h3>
          <table className="metrics-table"><tbody>
            <tr><td>longest horizon</td><td>{result.horizonCycles} cycles</td></tr>
            <tr><td>minimum stable <Tex>\sigma</Tex></td><td>{formatValue(result.minStableSigma, 'm')}</td></tr>
            <tr><td>minimum stable separation</td><td>{formatValue(result.stable.minSeparation, 'm')}</td></tr>
            <tr><td>stable states / <Tex>{'\\mathrm{mm}^2'}</Tex></td><td>{formatValue(result.stable.statesPerMm2)}</td></tr>
            <tr><td>stable states across aperture</td><td>{formatValue(result.stable.statesAcrossAperture)}</td></tr>
            {analyticW && <tr><td>analytic free-space <Tex>\sigma = w_0/2</Tex> <Badge kind="analytical" /></td><td>{formatValue(analyticW.value / 2, 'm')}</td></tr>}
            <tr>
              <td>dominant eigenmode <Badge kind="asymptotic" /></td>
              <td>{result.asymptotic.available ? <><Tex>|\lambda|</Tex> = {formatValue(result.asymptotic.eigenvalue)}, <Tex>\sigma</Tex> = {formatValue(result.asymptotic.modeSigma, 'm')}</> : result.asymptotic.note}</td>
            </tr>
          </tbody></table>

          <h4>transient capacity</h4>
          <table className="metrics-table"><thead><tr><th>horizon</th><th>min <Tex>\sigma</Tex></th><th>min <Tex>d</Tex></th><th>states / <Tex>{'\\mathrm{mm}^2'}</Tex></th><th>across aperture</th></tr></thead>
            <tbody>{result.transient.map((d) => (
              <tr key={d.horizon}><td>{d.horizon}</td><td>{formatValue(d.minSigma, 'm')}</td><td>{formatValue(d.minSeparation, 'm')}</td><td>{formatValue(d.statesPerMm2)}</td><td>{formatValue(d.statesAcrossAperture)}</td></tr>
            ))}</tbody>
          </table>

          <h4>per-blob traces</h4>
          {result.trials.map((tr) => (
            <div key={tr.sigma} className="trial">
              <div className="row-label"><Tex>\sigma</Tex> = {formatValue(tr.sigma, 'm')} · {tr.stable ? <span className="ok">stable</span> : <span className="bad">{tr.reasons.join('; ')}</span>}</div>
              <table className="metrics-table compact"><tbody>
                {tr.horizons.map((h) => (
                  <tr key={h.horizon}><td>{h.horizon}</td><td><Tex>\rho</Tex> {h.correlation.toFixed(3)}</td><td><Tex>\sigma/\sigma_0</Tex> {h.sigmaRatio.toFixed(2)}</td><td><Tex>d</Tex> {formatValue(h.minSeparation, 'm')}</td></tr>
                ))}
              </tbody></table>
              <LinePlot series={[{ values: tr.trace.correlation, x: tr.trace.cycles }, { values: tr.trace.sigma.map((s) => s / tr.trace.sigma0 - 1), x: tr.trace.cycles, dashed: true }]} threshold={t.minCorrelation} height={50} />
            </div>
          ))}
          {result.warnings.map((w, i) => <p key={i} className="warning-text">{w}</p>)}
        </section>
      )}
    </div>
  )
}
