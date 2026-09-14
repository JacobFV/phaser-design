import { useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultRegistry } from '../core/algorithms/registry'
import { AssetStore } from '../core/physics/assets'
import { compileRoute, type Route } from '../core/physics/topology/topology'
import type { SimulationConfig } from '../core/runtime/config'
import type { ObservationRequest } from '../core/runtime/observation'
import { phaserChamber } from '../core/runtime/presets'
import { formatValue } from '../presentation/components/format'
import { Tabs } from '../presentation/components/inputs'
import { useSimulation } from '../presentation/hooks/useSimulation'
import { chamberLayout, isChamberRoute } from '../presentation/layouts/chamberLayout'
import { routeLayout } from '../presentation/layouts/routeLayout'
import { Stage } from '../presentation/layouts/Stage'
import { AlgorithmPanel } from '../presentation/panels/AlgorithmPanel'
import { AnalysisPanel } from '../presentation/panels/AnalysisPanel'
import { ComputationPanel } from '../presentation/panels/ComputationPanel'
import { ExperimentPanel, type ViewSettings } from '../presentation/panels/ExperimentPanel'
import { PhysicsPanel } from '../presentation/panels/PhysicsPanel'
import { ChamberRenderer, type ProbeTarget } from '../presentation/renderers/ChamberRenderer'
import { RouteRenderer } from '../presentation/renderers/RouteRenderer'
import { chooseSliceSteps, leftNotes, rightNotes, type Anchors } from './notes'

const SPEEDS = [0.25, 0.5, 1, 2, 5, 30, 300, 3000]

function safeRoute(config: SimulationConfig): Route | null {
  try {
    return compileRoute(config.physics.topology)
  } catch {
    return null
  }
}

export default function App() {
  const sim = useSimulation(phaserChamber())
  const assets = useMemo(() => new AssetStore(), []) // UI-side mirror of uploaded arrays, for export
  const modules = useMemo(() => createDefaultRegistry().list(), [])
  const [configTab, setConfigTab] = useState<'physics' | 'computation' | 'algorithm'>('physics')
  const [runTab, setRunTab] = useState<'analysis' | 'experiment'>('analysis')
  const [selected, setSelected] = useState<string | null>(null)
  const [probe, setProbe] = useState<ProbeTarget | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(1)
  const [view, setView] = useState<ViewSettings>({ samplesPerSegment: 10, speed: 1, imageMode: 'intensity' })
  const [detectorHistory, setDetectorHistory] = useState<Float32Array[]>([])

  const { config, snapshot } = sim
  const route = useMemo(() => safeRoute(config), [config])
  const chamber = route && isChamberRoute(route) ? chamberLayout(config, route) : null
  const generic = route && !chamber ? routeLayout(config, route) : null
  const layout = chamber ?? generic
  const sliceSteps = useMemo(() => (route ? chooseSliceSteps(route) : []), [route])

  const observe: ObservationRequest = useMemo(() => ({
    sideView: { samplesPerSegment: view.samplesPerSegment },
    stepFields: sliceSteps,
    readouts: true,
    probe: probe ?? undefined,
  }), [view.samplesPerSegment, sliceSteps, probe])

  // ── clock: wall-time pacing and the wavefront sweep are presentation; the worker owns simulation time ──
  const clock = useRef({ pos: 1, oneShot: false, lastReq: 0 })
  const live = useRef({ playing, speed: view.speed, observe, busy: sim.busy, step: sim.step })
  live.current = { playing, speed: view.speed, observe, busy: sim.busy, step: sim.step }

  useEffect(() => {
    if (!snapshot) return
    if (live.current.speed <= 5 && (live.current.playing || clock.current.oneShot)) clock.current.pos = 0
    const img = snapshot.physics.readouts[0]
    if (img) {
      const row = new Float32Array(img.nx)
      for (let j = 0; j < img.ny; j++) for (let i = 0; i < img.nx; i++) row[i] += img.intensity[j * img.nx + i]
      setDetectorHistory((h) => [...h.slice(-159), row])
    }
  }, [snapshot])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const C = clock.current
      const L = live.current
      if (L.playing) {
        if (L.speed > 5) {
          if (!L.busy) {
            const count = Math.max(1, Math.min(5000, Math.round((L.speed * (now - (C.lastReq || now - 16))) / 1000)))
            if (L.step(count, L.observe)) C.lastReq = now
          }
          setProgress(1)
        } else {
          if (C.pos < 1) C.pos = Math.min(1, C.pos + dt * L.speed)
          else if (!L.busy) L.step(1, L.observe)
          setProgress(C.pos)
        }
      } else if (C.oneShot) {
        C.pos = Math.min(1, C.pos + dt * 1.2)
        if (C.pos >= 1) C.oneShot = false
        setProgress(C.pos)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stepOnce = () => {
    if (sim.step(1, observe) && !playing) clock.current.oneShot = true
  }

  const load = (c: SimulationConfig, embedded: { id: string; width: number; height: number; data: Float64Array }[]) => {
    Promise.all(embedded.map((a) => sim.putAsset(a.id, a.width, a.height, a.data))).then(() => {
      setSelected(null)
      setProbe(null)
      setDetectorHistory([])
      sim.load(c)
    })
  }

  const putAsset = (id: string, w: number, h: number, data: Float64Array) => {
    assets.put(id, w, h, data)
    return sim.putAsset(id, w, h, data)
  }

  const anchors: Anchors | null = chamber
    ? { elementAnchor: chamber.elementAnchor, stepAnchor: chamber.stepAnchor, input: { x: chamber.laser.x, y: chamber.laser.y + 23 }, detector: chamber.readout ? { x: chamber.readout.detector.x, y: chamber.readout.detector.y + 13 } : null }
    : generic
      ? { elementAnchor: generic.elementAnchor, stepAnchor: generic.stepAnchor, input: { x: generic.lane.x, y: generic.y0 - 20 }, detector: generic.readout ? { x: generic.readout.detector.x, y: generic.readout.detector.y + 13 } : null }
      : null

  const left = anchors ? leftNotes(config, snapshot, anchors, selected) : []
  const right = anchors ? rightNotes(config, snapshot, anchors, sliceSteps, view.imageMode, probe, () => setProbe(null), detectorHistory) : []
  const timing = snapshot?.physics.timing

  return (
    <div className="app">
      <header>
        <h1>PHASER</h1>
        <p>
          Compositional simulator for recurrent optical architectures. Physics (fields, elements, routes) → computation (regions, encodings, ports) → algorithms (workloads).
          The three layers are configured separately, and presentation only renders snapshots.
        </p>
      </header>

      <div className="transport">
        <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ pause' : '▶ run'}</button>
        <button onClick={stepOnce} disabled={sim.busy}>step ↻</button>
        <label className="ctl">
          <span className="ctl-label">round trips / s (wall)</span>
          <select value={view.speed} onChange={(e) => setView({ ...view, speed: Number(e.target.value) })}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="counter">cycle <b>{snapshot?.cycle ?? 0}</b></span>
        <span className="counter">t = <b>{formatValue(snapshot?.time ?? 0, 's')}</b></span>
        {timing && <span className="counter">f_rt <b>{formatValue(timing.roundTripFrequency, 'Hz')}</b></span>}
        {snapshot && <span className="counter">{snapshot.stepMs.toFixed(0)} ms / batch</span>}
        <span className="counter name">{config.name ?? 'custom configuration'}</span>
      </div>

      {sim.errors.length > 0 && (
        <div className="errors">
          {sim.errors.map((e, i) => <div key={i} className="error-text">{e} <button className="icon" onClick={() => sim.dismissError(i)}>×</button></div>)}
        </div>
      )}

      <div className="shell">
        <aside className="sidebar">
          <Tabs value={configTab} onChange={setConfigTab} tabs={[{ id: 'physics', label: 'Physics' }, { id: 'computation', label: 'Computation' }, { id: 'algorithm', label: 'Algorithm' }]} />
          {configTab === 'physics' && (
            <PhysicsPanel physics={config.physics} snapshot={snapshot} selected={selected} onSelect={setSelected}
              onChange={(physics) => sim.configure({ ...config, physics })} putAsset={putAsset} />
          )}
          {configTab === 'computation' && (
            <ComputationPanel computation={config.computation} snapshot={snapshot} onChange={(computation) => sim.configure({ ...config, computation })} onWritePort={sim.writePort} />
          )}
          {configTab === 'algorithm' && (
            <AlgorithmPanel algorithm={config.algorithm} modules={modules} computation={config.computation} snapshot={snapshot}
              onChange={(algorithm) => sim.configure({ ...config, algorithm })} onRestart={() => sim.reset(['algorithm'])} />
          )}
        </aside>

        <main>
          {!route && <p className="error-text">The topology does not compile. Check element positions and references.</p>}
          {layout && (
            <Stage vbW={layout.vbW} vbH={layout.vbH} left={left} right={right}
              onNoteClick={(id) => { if (id.startsWith('el:')) { setSelected(id.slice(3)); setConfigTab('physics') } }}>
              {chamber && (
                <ChamberRenderer layout={chamber} config={config} snapshot={snapshot} previous={sim.previous} progress={progress}
                  probe={probe} onProbe={setProbe} selected={selected} onSelect={(id) => { setSelected(id); setConfigTab('physics') }} />
              )}
              {generic && (
                <RouteRenderer layout={generic} config={config} snapshot={snapshot} progress={progress}
                  probe={probe} onProbe={setProbe} selected={selected} onSelect={(id) => { setSelected(id); setConfigTab('physics') }} />
              )}
            </Stage>
          )}
          {snapshot && !snapshot.physics.sideView && <p className="hint center">Press step or run to trace a round trip through the route.</p>}

          <section className="run-area">
            <Tabs value={runTab} onChange={setRunTab} tabs={[{ id: 'analysis', label: 'Analysis' }, { id: 'experiment', label: 'Runtime & experiment' }]} />
            {runTab === 'analysis' && <AnalysisPanel metrics={sim.metrics} snapshot={snapshot} job={sim.job} onCharacterize={sim.characterize} />}
            {runTab === 'experiment' && (
              <ExperimentPanel config={config} assets={assets} lastChange={sim.lastChange} view={view} onView={setView} onLoad={load}
                onReset={(scopes) => { if (scopes.includes('physical-field') || scopes.includes('full')) setDetectorHistory([]); sim.reset(scopes) }} />
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
