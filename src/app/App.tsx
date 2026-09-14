import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { monochromeRGB, rgbToCss } from '../presentation/color/spectrum'
import { Tex } from '../presentation/components/Tex'
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
const TARGET_BATCH_MS = 100 // wall time per fast-mode batch: keeps snapshots arriving ~10×/s

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
  // the light's display colour: sRGB projection of the (monochromatic) spectral line
  const tint = useMemo(() => monochromeRGB(config.physics.field.wavelength), [config.physics.field.wavelength])
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
  // msPerRt: measured worker cost of one round trip; lastCount: size of the batch awaiting its snapshot
  const clock = useRef({ pos: 1, oneShot: false, lastReq: 0, lastCount: 0, msPerRt: 0 })
  const live = useRef({ playing, speed: view.speed, observe, busy: sim.busy, step: sim.step })
  live.current = { playing, speed: view.speed, observe, busy: sim.busy, step: sim.step }
  const rateMark = useRef({ epoch: -1, cycle: 0, t: 0 })
  const [rate, setRate] = useState(0)

  useEffect(() => {
    if (!snapshot) return
    const C = clock.current
    if (C.lastCount > 0) {
      const est = snapshot.stepMs / C.lastCount
      C.msPerRt = C.msPerRt ? 0.7 * C.msPerRt + 0.3 * est : est
      C.lastCount = 0
    }
    const R = rateMark.current, now = performance.now()
    if (R.epoch !== snapshot.epoch) Object.assign(R, { epoch: snapshot.epoch, cycle: snapshot.cycle, t: now })
    else if (now - R.t > 500) {
      setRate(((snapshot.cycle - R.cycle) * 1000) / (now - R.t))
      Object.assign(R, { cycle: snapshot.cycle, t: now })
    }
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
            // Ask for the round trips owed since the last request, but never more than the worker can finish in
            // ~TARGET_BATCH_MS. Sizing by elapsed time alone feeds back: a slow batch makes the next one bigger.
            const owed = (L.speed * (now - (C.lastReq || now - 16))) / 1000
            const affordable = C.msPerRt > 0 ? TARGET_BATCH_MS / C.msPerRt : 1
            const count = Math.max(1, Math.min(5000, Math.round(Math.min(owed, affordable))))
            if (L.step(count, L.observe)) {
              C.lastReq = now
              C.lastCount = count
            }
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
  const right = anchors ? rightNotes(config, snapshot, anchors, sliceSteps, view.imageMode, probe, () => setProbe(null), detectorHistory, tint) : []
  const timing = snapshot?.physics.timing

  return (
    <div className="app" style={{ '--light': rgbToCss(tint) } as CSSProperties}>
      <div className="topbar">
        <div className="brand">
          <h1>PHASER</h1>
          <span className="tagline">recurrent optical architecture simulator</span>
        </div>
        <span className="divider" />
        <div className="tgroup">
          <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Run'}</button>
          <button onClick={stepOnce} disabled={sim.busy}>Step</button>
        </div>
        <label className="ctl">
          <span className="ctl-label">speed</span>
          <select value={view.speed} onChange={(e) => setView({ ...view, speed: Number(e.target.value) })}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ctl-label">round trips / s</span>
        </label>
        <span className="divider" />
        <div className="stats">
          <span className="stat">cycle <b>{snapshot?.cycle ?? 0}</b></span>
          <span className="stat"><Tex>t</Tex> <b>{formatValue(snapshot?.time ?? 0, 's')}</b></span>
          {timing && <span className="stat"><Tex>{'f_{\\mathrm{rt}}'}</Tex> <b>{formatValue(timing.roundTripFrequency, 'Hz')}</b></span>}
          <span className="stat"><Tex>\lambda</Tex> <b>{(config.physics.field.wavelength * 1e9).toFixed(0)} nm</b><span className="swatch" /></span>
          {snapshot && <span className="stat perf">batch <b>{snapshot.stepMs.toFixed(0)} ms</b></span>}
          {playing && view.speed > 5 && <span className="stat perf">actual <b>{rate.toFixed(0)} rt/s</b></span>}
        </div>
        <span className="config-name">{config.name ?? 'custom configuration'}</span>
      </div>

      {sim.errors.length > 0 && (
        <div className="errors">
          {sim.errors.map((e, i) => <div key={i} className="error-text"><span style={{ flex: 1 }}>{e}</span><button className="icon" onClick={() => sim.dismissError(i)}>×</button></div>)}
        </div>
      )}

      <div className="shell">
        <aside className="sidebar">
          <div className="tabs-bar">
            <Tabs value={configTab} onChange={setConfigTab} tabs={[{ id: 'physics', label: 'Physics' }, { id: 'computation', label: 'Computation' }, { id: 'algorithm', label: 'Algorithm' }]} />
          </div>
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
                <ChamberRenderer layout={chamber} config={config} snapshot={snapshot} previous={sim.previous} progress={progress} tint={tint}
                  probe={probe} onProbe={setProbe} selected={selected} onSelect={(id) => { setSelected(id); setConfigTab('physics') }} />
              )}
              {generic && (
                <RouteRenderer layout={generic} config={config} snapshot={snapshot} progress={progress} tint={tint}
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
