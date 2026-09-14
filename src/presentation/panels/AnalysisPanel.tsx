import { useState } from 'react'
import { DEFAULT_THRESHOLDS, type CharacterizationRequest, type StabilityThresholds } from '../../core/computation/analysis/characterize'
import type { Metric } from '../../core/physics/metrics/analytic'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import { formatValue } from '../components/format'
import { Badge, NumberInput, Row } from '../components/inputs'
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
        <h3>live numerical state</h3>
        <table className="metrics-table"><tbody>
          <tr><td>cycle</td><td>{snapshot?.cycle ?? 0}</td><td><Badge kind="numerical" /></td></tr>
          <tr><td>physical time</td><td>{formatValue(snapshot?.time ?? 0, 's')}</td><td><Badge kind="numerical" /></td></tr>
          <tr><td>mean intensity</td><td>{formatValue(snapshot?.physics.meanIntensity)}</td><td><Badge kind="numerical" /></td></tr>
          <tr><td>measured power ratio (last cycle)</td><td>{formatValue(measuredRetention)}</td><td><Badge kind="numerical" /></td></tr>
          {Object.entries(snapshot?.physics.elementStates ?? {}).map(([id, st]) => Object.entries(st).map(([k, v]) => (
            <tr key={id + k}><td>{id} {k}</td><td>{formatValue(v)}</td><td><Badge kind="numerical" /></td></tr>
          )))}
        </tbody></table>
        {energy && energy.length > 1 && <Sparkline values={energy} window={400} />}
      </section>

      {GROUPS.map((group) => {
        const ms = metrics.filter((m) => m.group === group)
        return ms.length > 0 && (
          <section key={group}>
            <h3>{group}</h3>
            <table className="metrics-table"><tbody>
              {ms.map((m) => (
                <tr key={m.key} title={m.note}>
                  <td>{m.label}{m.note && <span className="note-mark">*</span>}</td>
                  <td>{formatValue(m.value, m.unit)}</td>
                  <td><Badge kind={m.kind} /></td>
                </tr>
              ))}
            </tbody></table>
          </section>
        )
      })}

      <section>
        <h3>state characterisation</h3>
        <p className="hint">Launches Gaussian blobs into the current physics (no input, no algorithm) and measures how they evolve. Results are finite-horizon numerical statements, not proofs of infinite stability.</p>
        <Row label="blob σ list"><input className="text wide" value={sigmas} onChange={(e) => setSigmas(e.target.value)} /><span className="unit">µm</span></Row>
        <Row label="separations"><input className="text wide" value={seps} onChange={(e) => setSeps(e.target.value)} /><span className="unit">µm</span></Row>
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
          <Row label="min shape correlation"><NumberInput value={t.minCorrelation} min={0} max={1} onCommit={(v) => setT({ ...t, minCorrelation: v })} /></Row>
          <Row label="max leakage"><NumberInput value={t.maxLeakage} min={0} max={1} onCommit={(v) => setT({ ...t, maxLeakage: v })} /></Row>
          <Row label="max cross-talk"><NumberInput value={t.maxCrosstalk} min={0} max={1} onCommit={(v) => setT({ ...t, maxCrosstalk: v })} /></Row>
          <Row label="max width drift / cycle"><NumberInput value={t.maxWidthDriftPerCycle} min={0} onCommit={(v) => setT({ ...t, maxWidthDriftPerCycle: v })} /></Row>
          <Row label="max centroid drift / cycle"><NumberInput value={t.maxCentroidDriftPerCycle} min={0} onCommit={(v) => setT({ ...t, maxCentroidDriftPerCycle: v })} /></Row>
          <Row label="energy must be bounded">
            <input type="checkbox" checked={t.energy.kind === 'bounded'} onChange={(e) => setT({ ...t, energy: e.target.checked ? { kind: 'bounded', maxLogGrowthPerCycle: 0.01 } : { kind: 'ignore' } })} />
          </Row>
        </fieldset>
        <button className="primary" disabled={running || !horizons.length} onClick={() => onCharacterize({
          sigmas: parseList(sigmas).map((v) => v * 1e-6), separations: parseList(seps).map((v) => v * 1e-6), horizons, thresholds: t,
        })}>
          {running ? `running… ${job!.done}/${job!.total}` : 'run characterisation'}
        </button>
        {running && <progress value={job!.done} max={job!.total} />}
      </section>

      {result && (
        <section className="results">
          <h3>results <Badge kind="numerical" /></h3>
          <table className="metrics-table"><tbody>
            <tr><td>longest horizon</td><td>{result.horizonCycles} cycles</td></tr>
            <tr><td>minimum stable σ</td><td>{formatValue(result.minStableSigma, 'm')}</td></tr>
            <tr><td>minimum stable separation</td><td>{formatValue(result.stable.minSeparation, 'm')}</td></tr>
            <tr><td>stable states / mm²</td><td>{formatValue(result.stable.statesPerMm2)}</td></tr>
            <tr><td>stable states across aperture</td><td>{formatValue(result.stable.statesAcrossAperture)}</td></tr>
            {analyticW && <tr><td>analytic free-space σ (w₀/2) <Badge kind="analytical" /></td><td>{formatValue(analyticW.value / 2, 'm')}</td></tr>}
            <tr>
              <td>dominant eigenmode <Badge kind="asymptotic" /></td>
              <td>{result.asymptotic.available ? `|λ| = ${formatValue(result.asymptotic.eigenvalue)}, σ = ${formatValue(result.asymptotic.modeSigma, 'm')}` : result.asymptotic.note}</td>
            </tr>
          </tbody></table>

          <h4>transient capacity</h4>
          <table className="metrics-table"><thead><tr><th>horizon</th><th>min σ</th><th>min sep.</th><th>states/mm²</th><th>across aperture</th></tr></thead>
            <tbody>{result.transient.map((d) => (
              <tr key={d.horizon}><td>{d.horizon}</td><td>{formatValue(d.minSigma, 'm')}</td><td>{formatValue(d.minSeparation, 'm')}</td><td>{formatValue(d.statesPerMm2)}</td><td>{formatValue(d.statesAcrossAperture)}</td></tr>
            ))}</tbody>
          </table>

          <h4>per-blob traces</h4>
          {result.trials.map((tr) => (
            <div key={tr.sigma} className="trial">
              <div className="row-label">σ = {formatValue(tr.sigma, 'm')} · {tr.stable ? <span className="ok">stable</span> : <span className="bad">{tr.reasons.join('; ')}</span>}</div>
              <table className="metrics-table compact"><tbody>
                {tr.horizons.map((h) => (
                  <tr key={h.horizon}><td>{h.horizon}</td><td>corr {h.correlation.toFixed(3)}</td><td>σ×{h.sigmaRatio.toFixed(2)}</td><td>sep {formatValue(h.minSeparation, 'm')}</td></tr>
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
