import { useRef, useState } from 'react'
import type { AssetStore } from '../../core/physics/assets'
import type { ConfigChange, ResetScope, SimulationConfig } from '../../core/runtime/config'
import { PRESETS } from '../../core/runtime/presets'
import { exportExperiment, importExperiment } from '../../core/runtime/serialize'
import { NumberInput, Row, Select } from '../components/inputs'

export interface ViewSettings {
  samplesPerSegment: number
  speed: number // round trips per second of wall time
  imageMode: 'intensity' | 'phase'
}

interface Props {
  config: SimulationConfig
  assets: AssetStore
  lastChange: { applied: ResetScope[]; change: ConfigChange } | null
  view: ViewSettings
  onView: (v: ViewSettings) => void
  onLoad: (c: SimulationConfig, embedded: { id: string; width: number; height: number; data: Float64Array }[]) => void
  onReset: (scopes: ResetScope[]) => void
}

/** Runtime & experiment management. View settings live here but are NOT part of SimulationConfig. */
export function ExperimentPanel({ config, assets, lastChange, view, onView, onLoad, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [embed, setEmbed] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const download = () => {
    const blob = new Blob([exportExperiment(config, assets, { embedAssets: embed })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(config.name ?? 'experiment').replace(/\W+/g, '-').toLowerCase()}.phaser.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const load = async (file: File) => {
    try {
      const { config: next, missing } = importExperiment(await file.text(), assets)
      const embedded = assets.list().map((a) => ({ id: a.ref.id, width: a.ref.width, height: a.ref.height, data: a.data }))
      onLoad(next, embedded)
      setMessage(missing.length ? `loaded, but ${missing.length} referenced array(s) are missing: ${missing.map((m) => m.id).join(', ')}` : `loaded ${next.name ?? file.name}`)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <div className="panel experiment">
      <section>
        <h3>preset</h3>
        <Row label="load preset">
          <Select value="" options={[{ value: '', label: 'choose…' }, ...PRESETS.map((p) => ({ value: p.id, label: p.name }))]} onChange={(id) => { const p = PRESETS.find((x) => x.id === id); if (p) onLoad(p.build(), []) }} />
        </Row>
        <Row label="name"><span className="readonly">{config.name ?? 'untitled'}</span></Row>
      </section>

      <section>
        <h3>reset</h3>
        <p className="hint">Resets are explicit. Edits only reset what correctness requires.</p>
        <div className="button-row">
          <button className="small" onClick={() => onReset(['physical-field'])}>optical field</button>
          <button className="small" onClick={() => onReset(['algorithm'])}>algorithm</button>
          <button className="small" onClick={() => onReset(['computation'])}>computation</button>
          <button className="small danger" onClick={() => onReset(['full'])}>everything</button>
        </div>
        {lastChange && (
          <p className="hint">
            last edit: {[
              lastChange.change.recompilePhysics && 'rebuilt optical operators',
              lastChange.change.programUpdates.length && `loaded programs into ${lastChange.change.programUpdates.join(', ')}`,
              lastChange.change.recompileComputation && 'rebuilt regions',
              lastChange.change.reloadAlgorithm && 'reloaded algorithm',
            ].filter(Boolean).join(', ') || 'no change'} · resets: {lastChange.applied.length ? lastChange.applied.join(', ') : 'none (state preserved)'}
          </p>
        )}
      </section>

      <section>
        <h3>experiment file</h3>
        <Row label="embed arrays"><input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} /></Row>
        <div className="button-row">
          <button className="small" onClick={download}>export JSON</button>
          <button className="small" onClick={() => fileRef.current?.click()}>import JSON…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </div>
        {message && <p className="hint">{message}</p>}
      </section>

      <section>
        <h3>runtime</h3>
        <Row label="seed"><span className="readonly">{config.runtime.seed}</span></Row>
        <Row label="energy history"><span className="readonly">{config.runtime.historyLength} cycles</span></Row>
      </section>

      <section>
        <h3>view (presentation only)</h3>
        <Row label="side-view samples / segment"><NumberInput value={view.samplesPerSegment} min={1} max={48} onCommit={(v) => onView({ ...view, samplesPerSegment: Math.round(v) })} /></Row>
        <Row label="slices show">
          <Select value={view.imageMode} options={[{ value: 'intensity', label: '|E|²' }, { value: 'phase', label: 'phase · |E|' }]} onChange={(imageMode) => onView({ ...view, imageMode })} />
        </Row>
      </section>
    </div>
  )
}
