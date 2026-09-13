import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildMasks, rowsFor, type ProbeSpec, type TripRec } from './physics/cavity'
import { DEFAULT_PARAMS, N, N_TOKENS, STRUCTURAL, type Params } from './physics/params'
import { renderInput } from './physics/patterns'
import { metrics, sci } from './physics/metrics'
import type { FromWorker, ToWorker } from './physics/worker'
import { geometry } from './layout'
import { Simulation } from './components/Simulation'
import { Stage, type Note } from './components/Stage'
import { Check, Select, Slider, Transport } from './components/Controls'
import { Waveform, projectImage } from './components/Waveform'
import { FieldImage, type ImageMode } from './components/FieldImage'
import { Kymograph, Sparkline } from './components/Plots'

interface Trip {
  rec: TripRec | null
  prev: TripRec | null
}

export default function App() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [trip, setTrip] = useState<Trip>({ rec: null, prev: null })
  const [progress, setProgress] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [probe, setProbeState] = useState<ProbeSpec | null>(null)
  const [imageMode, setImageMode] = useState<ImageMode>('intensity')

  const worker = useRef<Worker | null>(null)
  const gen = useRef(0)
  const clock = useRef({ pos: 1, oneShot: false, busy: false, lastReq: 0 })
  const live = useRef({ playing, speed, probe })
  live.current = { playing, speed, probe }

  const post = (msg: ToWorker, transfer: Transferable[] = []) => worker.current?.postMessage(msg, transfer)

  const init = useCallback((p: Params) => {
    gen.current++
    const input = renderInput(p)
    clock.current.busy = true
    clock.current.pos = 1
    setProgress(1)
    setProbeState(null)
    post({ type: 'init', gen: gen.current, params: p, input, probe: null }, [input.buffer])
  }, [])

  const requestStep = (count: number) => {
    clock.current.busy = true
    post({ type: 'step', gen: gen.current, count, probe: live.current.probe })
  }

  // the physics runs in a worker; the UI thread only draws
  useEffect(() => {
    const w = new Worker(new URL('./physics/worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.gen !== gen.current) return
      if (m.type === 'trip') {
        const C = clock.current
        C.busy = false
        if (live.current.speed <= 5 && (live.current.playing || C.oneShot)) C.pos = 0
        setTrip((t) => ({ rec: m.rec, prev: t.rec && t.rec.down.rows === m.rec.down.rows ? t.rec : null }))
      } else {
        setTrip((t) => (t.rec ? { ...t, rec: { ...t.rec, images: { ...t.rec.images, probe: m.image } } } : t))
      }
    }
    init(DEFAULT_PARAMS)
    return () => w.terminate()
  }, [init])

  // animation clock: position within the current round trip drives the wavefront sweep
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
          if (!C.busy) {
            requestStep(Math.max(1, Math.min(8, Math.round((L.speed * (now - C.lastReq)) / 1000))))
            C.lastReq = now
          }
          setProgress(1)
        } else {
          if (C.pos < 1) C.pos = Math.min(1, C.pos + dt * L.speed)
          else if (!C.busy) requestStep(1)
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

  const set = (patch: Partial<Params>) => {
    const next = { ...params, ...patch }
    setParams(next)
    if (STRUCTURAL.some((k) => k in patch && patch[k] !== params[k])) init(next)
    else post({ type: 'live', params: next })
  }

  const setProbe = (p: ProbeSpec | null) => {
    setProbeState(p)
    if (p) post({ type: 'probe', gen: gen.current, probe: p })
  }

  const step = () => {
    if (clock.current.busy) return
    if (!playing) clock.current.oneShot = true
    requestStep(1)
  }

  const { S, rows } = rowsFor(params.nLcd)
  const g = useMemo(() => geometry(params.nLcd, rows, S), [params.nLcd, rows, S])
  const { masks, mOut } = useMemo(() => buildMasks(params), [params.nLcd, params.program, params.depth, params.seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const xAmp = useMemo(() => renderInput(params), [params.input, params.text, params.token, params.seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = metrics(params)
  const { rec } = trip
  const n = params.nLcd
  const inPower = 1 - params.rIn
  const zMm = (row: number) => ((row / S) * params.dSepMm).toFixed(1)
  const kv = (k: ReactNode, v: ReactNode, hl = false) => <div className={`kv ${hl ? 'hl' : ''}`}><span>{k}</span><b>{v}</b></div>

  const left: Note[] = [
    {
      id: 'laser', anchor: { x: g.laser.x, y: g.laser.y + 23 },
      title: <>Laser</>,
      body: (
        <>
          Coherent, monochromatic source. The post uses 650 nm, the longest transmitted wavelength.
          <Slider label="λ" value={params.lambdaNm} min={400} max={700} step={5} onChange={(lambdaNm) => set({ lambdaNm })} fmt={(v) => `${v} nm`} />
        </>
      ),
    },
    {
      id: 'm_in', anchor: { x: g.down.x, y: g.mInY + 4 },
      title: <><span className="mono">M_in</span> · input encoder</>,
      body: (
        <>
          Writes <i>x</i><sub>t</sub> onto the {N / 2}×{N / 2}-pixel wavefront.
          <Select label="xₜ" value={params.input} onChange={(input) => set({ input })} options={[
            ['smiley', 'smiley face'], ['text', 'text'], ['token', 'one-hot token'], ['gaussian', 'gaussian beam'],
            ['uniform', 'x = 1ⁿ'], ['slits', 'double slit'], ['bits', 'random bits'],
          ]} />
          {params.input === 'text' && (
            <label className="ctl"><span className="ctl-label">text</span>
              <input className="text-in" value={params.text} maxLength={12} onChange={(e) => set({ text: e.target.value })} />
            </label>
          )}
          {params.input === 'token' && <Slider label="token" value={params.token} min={0} max={N_TOKENS - 1} step={1} onChange={(token) => set({ token })} />}
          <Select label="inject" value={params.injection} onChange={(injection) => set({ injection })} options={[['pulse', 'once at t = 0'], ['continuous', 'every round trip']]} />
        </>
      ),
    },
    {
      id: 'coupler_in', anchor: { x: g.down.x - 14, y: g.couplerInY },
      title: 'Partially reflective coupler',
      body: (
        <>
          Reflects √R of the returning state and admits √(1−R) of the input: <span className="mono">h<sub>t</sub> = M_in x<sub>t</sub> + M_step h<sub>t−1</sub></span>.
          <Slider label="R_in" value={params.rIn} min={0.5} max={0.999} step={0.001} onChange={(rIn) => set({ rIn })} />
        </>
      ),
    },
    {
      id: 'chamber', anchor: { x: g.chamber.x, y: g.chamber.y + 150 },
      title: 'Recurrent photon chamber',
      body: (
        <>
          <Slider label="N_lcd" value={params.nLcd} min={1} max={10} step={1} onChange={(nLcd) => set({ nLcd })} />
          <Slider label="d_sep" value={params.dSepMm} min={1} max={60} step={1} onChange={(dSepMm) => set({ dSepMm })} fmt={(v) => `${v} mm`} />
          <Select label="walls" value={params.walls} onChange={(walls) => set({ walls })} options={[['periodic', 'periodic (lossless)'], ['absorb', 'absorbing']]} />
          <Check label="vacuum (no air absorption)" value={params.vacuum} onChange={(vacuum) => set({ vacuum })} />
          {kv(<>steps/s = c/L</>, `${sci(m.stepsPerSec)} Hz`)}
          {kv(<>naive ops/s</>, sci(m.naive))}
          {kv(<>local ops/s</>, sci(m.local), true)}
          <p className="aside">For 1000×1000-px LCDs. The post quotes 3×10⁸ Hz for L = 0.1 m, but c/L is 3×10⁹ Hz, so its totals are 10× low.</p>
        </>
      ),
    },
    {
      id: 'm_step', anchor: { x: g.chamber.x + 12, y: g.planeY(Math.floor((n - 1) / 2)) },
      title: <><span className="mono">M_step</span> · {n} LCD plane{n > 1 ? 's' : ''}</>,
      body: (
        <>
          Each pixel shifts phase, and free-space diffraction across d<sub>sep</sub> mixes neighbours in x <i>and</i> y. Each crossing is one matrix multiply.
          <Select label="masks" value={params.program} onChange={(program) => set({ program })} options={[
            ['random', 'random phase'], ['grating', 'diagonal gratings'], ['lenslets', 'lenslet arrays'], ['off', 'blank'],
          ]} />
          <Slider label="depth" value={params.depth} min={0} max={1} step={0.01} onChange={(depth) => set({ depth })} fmt={(v) => `${(v * 2).toFixed(2)}π`} />
          <Slider label="D" value={params.pitchUm} min={20} max={150} step={0.5} onChange={(pitchUm) => set({ pitchUm })} fmt={(v) => `${v} µm`} />
          <button className="small" onClick={() => set({ seed: (params.seed * 48271) % 2147483647 })}>reseed masks</button>
          {kv(<>θ = 1.22λ/D</>, `${m.theta.toFixed(4)} rad`)}
          {kv(<>N<sub>efferents</sub> = Aρ²</>, m.nEff.toFixed(1), true)}
          <p className="aside">Hover a plane to see its diffraction cones.</p>
        </>
      ),
    },
    {
      id: 'gain', anchor: { x: g.down.x - 8, y: g.gainY },
      title: 'Thin-film gain medium',
      body: (
        <>
          <Slider label="gain G" value={params.gain} min={1} max={3} step={0.01} onChange={(gain) => set({ gain })} />
          <Slider label="T_lcd" value={params.tLcd} min={0.8} max={1} step={0.005} onChange={(tLcd) => set({ tLcd })} />
          <Slider label="Kerr φ" value={params.kerr} min={0} max={3} step={0.05} onChange={(kerr) => set({ kerr })} fmt={(v) => `${v.toFixed(2)} rad`} />
          <Check label="saturable gain" value={params.saturable} onChange={(saturable) => set({ saturable })} />
          {kv('passive retention / trip', `${(m.passive * 100).toFixed(1)}%`)}
          {kv('G_eff now', rec ? rec.gainEff.toFixed(3) : '–')}
          {rec && <Sparkline values={rec.energyHistory} />}
          <p className={`aside status ${regime(params, m.loopGain, rec)}`}>{regimeText(params, m.loopGain, rec)}</p>
        </>
      ),
    },
    {
      id: 'coupler_out', anchor: { x: g.down.x - 14, y: g.couplerOutY },
      title: 'Readout coupler',
      body: (
        <>
          Leaks 1−R<sub>out</sub> of the state each round trip. At {sci(m.local)} ops/s the readout outpaces every phone in San Francisco combined: this is the I/O bottleneck.
          <Slider label="R_out" value={params.rOut} min={0.5} max={0.999} step={0.001} onChange={(rOut) => set({ rOut })} />
        </>
      ),
    },
    {
      id: 'lens', anchor: { x: g.down.x - 3, y: g.lensY },
      title: <><span className="mono">M_out</span> + focusing lens</>,
      body: <>The lens maps each angle to a position, so its focal plane holds the 2D Fourier transform |𝓕{'{'}M_out·h<sub>t</sub>{'}'}|².</>,
    },
    {
      id: 'ccd', anchor: { x: g.ccd.x, y: g.ccd.y + 13 },
      title: <>CCD · <i>y</i><sub>t</sub></>,
      body: <>Square-law detection |E|² is the only nonlinearity besides gain saturation and Kerr phase. This is the post's "sigmoid-like operation measured at the readout".</>,
    },
  ]

  const slice = (id: string, anchor: Note['anchor'], title: ReactNode, img: Float32Array | undefined, meta: string, norm = inPower, extra?: ReactNode): Note => ({
    id, anchor, kind: 'slice', title: <>{title}{extra}</>,
    body: img ? <SliceBody img={img} mode={imageMode} meta={meta} P={sci(power(img) / norm)} /> : <div className="slice-meta">computing…</div>,
  })

  const R = g.down.x + g.down.w
  const right: Note[] = rec ? [
    slice('s_x', { x: R, y: g.mInY + 4 }, <>x<sub>t</sub> after M_in</>, rec.images.x, 'input', 1),
    slice('s_h0', { x: R, y: g.rowY(1) }, <>h<sub>t</sub> entering ↓</>, rec.images.h0, 'z = 0'),
    slice('s_p0', { x: R, y: g.planeY(0) }, <>after plane 1 ↓</>, rec.images.p0, `z = ${zMm(S)} mm`),
    ...(n > 2 ? [slice('s_pm', { x: R, y: g.planeY(Math.floor((n - 1) / 2)) }, <>after plane {Math.floor((n - 1) / 2) + 1} ↓</>, rec.images['p' + Math.floor((n - 1) / 2)], `z = ${zMm((Math.floor((n - 1) / 2) + 1) * S)} mm`)] : []),
    ...(n > 1 ? [slice('s_pn', { x: R, y: g.planeY(n - 1) }, <>after plane {n} ↓</>, rec.images['p' + (n - 1)], `z = ${zMm(n * S)} mm`)] : []),
    slice('s_ret', { x: g.up.x + g.up.w, y: g.rowY(2) }, <>return ↑ to input coupler</>, rec.images.ret, 'becomes h at t+1'),
    ...(probe ? [slice('s_probe', { x: (probe.lane === 'down' ? R : g.up.x + g.up.w), y: g.rowY(probe.row) }, <>probe {probe.lane === 'down' ? '↓' : '↑'}</>, rec.images.probe, `z = ${zMm(probe.row)} mm`, inPower,
      <button className="x" onClick={() => setProbe(null)}>×</button>)] : []),
    slice('s_out', { x: R, y: g.mOutY + 4 }, <>readout after M_out</>, rec.images.out, 'sample'),
    {
      id: 's_ccd', anchor: { x: g.ccd.x + g.ccd.w, y: g.ccd.y + 13 }, kind: 'slice',
      title: <>CCD focal plane · y<sub>t</sub></>,
      body: (
        <>
          <div className="slice">
            <FieldImage data={rec.ccd} intensity mode="intensity" size={96} />
            <div className="slice-side">
              <Kymograph rows={rec.ccdHistory} count={rec.ccdCount} bins={N} height={70} />
              <div className="slice-meta"><span>↓ time · projection per trip</span></div>
            </div>
          </div>
        </>
      ),
    },
  ] : []

  return (
    <div className="app">
      <header>
        <h1>PHASER</h1>
        <p>
          A simulation of a recurrent photon chamber: a 2D wavefront circulating through programmable LCD planes. Every round trip is one RNN step,{' '}
          <span className="eq">h<sub>t</sub> = M<sub>in</sub>x<sub>t</sub> + M<sub>step</sub>h<sub>t−1</sub>,&nbsp; y<sub>t</sub> = M<sub>out</sub>h<sub>t</sub></span>.{' '}
          <a href="https://jvboid.dev/posts/phaser" target="_blank" rel="noreferrer">Read the post ↗</a>
        </p>
      </header>
      <Transport
        playing={playing} onPlay={() => setPlaying((v) => !v)} onStep={step} onReset={() => init(params)}
        speed={speed} setSpeed={setSpeed} t={rec ? rec.t : 0} ms={rec ? rec.ms : 0}
        imageMode={imageMode} setImageMode={setImageMode}
      />
      <main>
        <Stage g={g} left={left} right={right}>
          <Simulation rec={rec} prev={trip.prev} progress={progress} g={g} params={params} masks={masks} mOut={mOut}
            rows={rows} xAmp={xAmp} probe={probe} onProbe={setProbe} />
        </Stage>
      </main>
      <footer>
        Model: scalar, monochromatic angular-spectrum propagation of a {N}×{N}-sample transverse wavefront (64×64 LCD pixels, 2×2 samples each).
        The side view and 1D traces are projections onto x. Brightness follows |E|·cos²(kz − ωt + φ), with the crest spacing enlarged so it's visible.
        Saturable gain has P<sub>sat</sub> = 0.5. Click anywhere inside the chamber to place a probe.
      </footer>
    </div>
  )
}

function power(img: Float32Array) {
  let s = 0
  for (let i = 0; i < img.length; i += 2) s += img[i] ** 2 + img[i + 1] ** 2
  return s / (img.length / 2)
}

function SliceBody({ img, mode, meta, P }: { img: Float32Array; mode: ImageMode; meta: string; P: string }) {
  const { I, ph } = projectImage(img)
  return (
    <div className="slice">
      <FieldImage data={img} mode={mode} size={96} />
      <div className="slice-side">
        <Waveform intensity={I} phase={ph} width={180} height={52} xLabel="projection onto x" />
        <div className="slice-meta"><span>{meta}</span><span>P = {P}</span></div>
      </div>
    </div>
  )
}

function regime(p: Params, loop: number, rec: TripRec | null) {
  if (rec?.lasing || (!p.saturable && loop > 1)) return 'bad'
  if (loop < 1 && p.injection === 'pulse') return 'warn'
  return 'ok'
}

function regimeText(p: Params, loop: number, rec: TripRec | null) {
  const lg = `small-signal loop gain ${loop.toFixed(3)}`
  if (rec?.lasing) return `${lg}: runaway lasing (clamped)`
  if (!p.saturable && loop > 1) return `${lg}: unsaturated, grows without bound`
  if (loop < 1) return p.injection === 'pulse' ? `${lg}: the pulse decays` : `${lg}: driven steady state`
  return `${lg}: gain saturates into dynamic equilibrium`
}
