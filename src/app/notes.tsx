import type { OpticalElementSpec } from '../core/physics/elements/types'
import type { Route } from '../core/physics/topology/topology'
import type { SimulationConfig } from '../core/runtime/config'
import type { SimulationSnapshot } from '../core/runtime/snapshots'
import type { RGB } from '../presentation/color/spectrum'
import { FieldImage, type ImageMode } from '../presentation/components/FieldImage'
import { formatValue } from '../presentation/components/format'
import { Kymograph } from '../presentation/components/Plots'
import { Rich, Tex } from '../presentation/components/Tex'
import { Waveform, projectPacked } from '../presentation/components/Waveform'
import type { Note } from '../presentation/layouts/Stage'
import type { ProbeTarget } from '../presentation/renderers/ChamberRenderer'

export interface Anchors {
  elementAnchor: (id: string) => { x: number; y: number } | null
  stepAnchor: (i: number) => { x: number; y: number } | null
  input: { x: number; y: number }
  detector: { x: number; y: number } | null
}

const pct = (v: number) => `${(v * 100).toFixed(v > 0.995 && v < 1 ? 2 : 1)}%`
const um = (v: number) => `${(v * 1e6).toFixed(v < 1e-5 ? 1 : 0)} µm`
const mm = (v: number) => `${(v * 1e3).toFixed(1)} mm`

/** One-line physical summary per element kind (what matters at a glance). Inline math between `$…$`. */
export function summary(e: OpticalElementSpec): string {
  switch (e.kind) {
    case 'mirror': return `$R$ ${pct(e.reflectivity.front)}${e.reflectivity.back !== e.reflectivity.front ? ` / ${pct(e.reflectivity.back)}` : ''}${e.parity !== 'none' ? ` · ${e.parity}` : ''}`
    case 'coupler': return `retains ${pct(e.retained.front)}${e.outputTap ? ` · tap ${e.outputTap}` : ''}${e.inputPort ? ` · input ${e.inputPort}` : ''}`
    case 'lens': return `$f$ ${mm(e.focalLength)} · $\\varnothing$ ${mm(e.apertureDiameter)}`
    case 'microlens-array': return `pitch ${um(e.pitch.x)} · $f$ ${mm(e.focalLength)}`
    case 'aperture': return `${e.shape} ${mm(e.size.x)}`
    case 'lcos-slm': return `$${e.pixels.resolution.x}^2$ px · ${um(e.pixels.pitch.x)} · $R$ ${pct(e.reflectivity)} · ${e.program.kind}`
    case 'transmissive-lcd': return `$${e.pixels.resolution.x}^2$ px · ${um(e.pixels.pitch.x)} · ${e.modulation.kind} · ${e.program.kind}`
    case 'lcd-microlens': return `LCD ${um(e.lcd.pixels.pitch.x)} + MLA $f$ ${mm(e.microlens.focalLength)} · gap ${mm(e.spacing)}`
    case 'phase-plate': return `static ${e.program.kind} · $${e.pixels.resolution.x}^2$ px`
    case 'gain': return `$G_0$ ${e.smallSignalGain} · saturation ${e.saturation.kind}${e.noise.kind !== 'none' ? ' · noise' : ''}`
    case 'nonlinear': return `amplitude ${e.amplitude.kind} · phase ${e.phase.kind}`
  }
}

/** Element-state keys reported by the solver → math labels. */
const STATE_TEX: Record<string, string> = { gain: 'G', phase: '\\varphi', intensity: 'I', saturation: 'I/I_\\mathrm{sat}' }

export function leftNotes(config: SimulationConfig, snapshot: SimulationSnapshot | null, a: Anchors, selected: string | null): Note[] {
  const notes: Note[] = []
  const inputs = config.computation.ports.filter((p) => p.direction === 'input')
  notes.push({
    id: 'input', anchor: a.input, title: 'Input',
    body: <><Tex>{`\\lambda = ${(config.physics.field.wavelength * 1e9).toFixed(0)}\\,\\mathrm{nm}`}</Tex>. {inputs.length ? `Ports ${inputs.map((p) => `${p.id}→${p.direction === 'input' ? p.physicalPort : ''}`).join(', ')}.` : 'No input ports.'} Workload: <b>{config.algorithm.module}</b>.</>,
  })
  const steps = snapshot?.physics.route.steps ?? []
  const positions = new Map<string, number>()
  for (const s of steps) if (s.kind === 'element' && s.pass === 'forward' && !positions.has(s.elementId)) positions.set(s.elementId, s.distance)
  for (const e of config.physics.elements) {
    const anchor = a.elementAnchor(e.id)
    if (!anchor) continue
    const visits = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'element' && s.elementId === e.id)
    const state = snapshot?.physics.elementStates[e.id]
    notes.push({
      id: `el:${e.id}`,
      anchor,
      title: <span className={selected === e.id ? 'selected-title' : ''}>{e.label ?? e.id}</span>,
      body: (
        <>
          <Rich>{summary(e)}</Rich>
          {positions.has(e.id) && positions.get(e.id)! > 1e-12 && (
            <div className="kv"><span>position</span><b>{mm(positions.get(e.id)!)}</b></div>
          )}
          {visits.length > 0 && snapshot && (
            <div className="kv">
              <span>per visit <Tex>T</Tex></span>
              <b>{visits.map(({ s, i }) => `${s.kind === 'element' && s.side === 'front' ? 'F' : 'B'} ${formatValue(snapshot.physics.budget[i]?.transmission)}`).join(' · ')}</b>
            </div>
          )}
          {state && Object.entries(state).map(([k, v]) => <div key={k} className="kv"><span>{STATE_TEX[k] ? <Tex>{STATE_TEX[k]}</Tex> : k} now</span><b>{formatValue(v)}</b></div>)}
        </>
      ),
    })
  }
  if (a.detector && config.physics.readouts[0]) {
    const r = config.physics.readouts[0]
    const img = snapshot?.physics.readouts.find((x) => x.id === r.id)
    notes.push({
      id: 'detector', anchor: a.detector, title: `Readout · ${r.id}`,
      body: (
        <>
          {r.detector.kind === 'fourier-plane'
            ? <>Ideal lens, <Tex>{`f = ${(r.detector.focalLength * 1e3).toFixed(1)}\\,\\mathrm{mm}`}</Tex>: detector at the Fourier plane.</>
            : 'Near-field intensity at the tap.'}{' '}
          Square-law detection <Tex>|E|^2</Tex>.{img && <> Power <Tex>P</Tex> = {formatValue(img.power)}.</>}
        </>
      ),
    })
  }
  return notes
}

/** Route steps worth a slice: after each element visit (sampled down to `max`) plus the end of the round trip. */
export function chooseSliceSteps(route: Route, max = 6): number[] {
  const els = route.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'element').map(({ i }) => i)
  const picks = new Set<number>()
  if (els.length <= max - 1) els.forEach((i) => picks.add(i))
  else for (let k = 0; k < max - 1; k++) picks.add(els[Math.round((k * (els.length - 1)) / (max - 2))])
  picks.add(route.steps.length - 1)
  return [...picks].sort((a, b) => a - b)
}

export function rightNotes(
  config: SimulationConfig, snapshot: SimulationSnapshot | null, a: Anchors, steps: number[], mode: ImageMode,
  probe: ProbeTarget | null, onClearProbe: () => void, detectorHistory: Float32Array[], tint: RGB,
): Note[] {
  if (!snapshot) return []
  const { grid } = snapshot.physics
  const labels = new Map(config.physics.elements.map((e) => [e.id, e.label ?? e.id]))
  const slice = (id: string, anchor: { x: number; y: number }, title: React.ReactNode, data: Float32Array, meta: string): Note => {
    const { I, phase } = projectPacked(data, grid.nx, grid.ny)
    let p = 0
    for (let i = 0; i < data.length; i += 2) p += data[i] ** 2 + data[i + 1] ** 2
    return {
      id, anchor, kind: 'slice', title,
      body: (
        <>
          <div className="slice-body">
            <FieldImage data={data} nx={grid.nx} ny={grid.ny} mode={mode} size={84} tint={tint} />
            <div className="slice-side">
              <Waveform intensity={I} phase={phase} height={46} xLabel="projection onto x" />
            </div>
          </div>
          <div className="slice-meta"><span>{meta}</span><span><Tex>\bar I</Tex> <b>{formatValue(p / (data.length / 2))}</b></span></div>
        </>
      ),
    }
  }
  const notes: Note[] = []
  const route = snapshot.physics.route
  for (const i of steps) {
    const data = snapshot.physics.stepFields[i]
    const anchor = a.stepAnchor(i)
    const s = route.steps[i]
    if (!data || !anchor || !s) continue
    const last = i === route.steps.length - 1
    const title = last ? 'end of round trip' : s.kind === 'element' ? `after ${labels.get(s.elementId)} (${s.side})` : `after ${(s.length * 1e3).toFixed(1)} mm`
    notes.push(slice(`step:${i}`, anchor, title, data, `${formatValue(s.distance + (s.kind === 'propagate' ? s.length : 0), 'm')} along route`))
  }
  if (probe && snapshot.physics.probe) {
    const s = route.steps[probe.stepIndex]
    const anchor = a.stepAnchor(probe.stepIndex)
    if (s && anchor && s.kind === 'propagate') {
      notes.push({
        ...slice('probe', anchor, <>probe <button className="icon" onClick={onClearProbe}>×</button></>, snapshot.physics.probe, `${formatValue(s.distance + s.length * probe.fraction, 'm')} along route`),
      })
    }
  }
  const img = snapshot.physics.readouts[0]
  if (img && a.detector) {
    notes.push({
      id: 'readout-image', anchor: a.detector, kind: 'slice', title: `detector · ${img.id}`,
      body: (
        <>
          <div className="slice-body">
            <FieldImage data={img.intensity} nx={img.nx} ny={img.ny} intensity mode="intensity" size={84} tint={tint} />
            <div className="slice-side">
              <Kymograph rows={detectorHistory} bins={img.nx} height={84} tint={tint} />
            </div>
          </div>
          <div className="slice-meta"><span><Tex>|E|^2</Tex> now</span><span>history ↓ time</span></div>
        </>
      ),
    })
  }
  return notes
}
