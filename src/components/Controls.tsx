import type { ReactNode } from 'react'
import type { ImageMode } from './FieldImage'

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 15]

export function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: ReactNode; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; fmt?: (v: number) => string
}) {
  return (
    <label className="ctl">
      <span className="ctl-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span className="ctl-value">{fmt ? fmt(value) : value}</span>
    </label>
  )
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label: ReactNode; value: T; options: [T, string][]; onChange: (v: T) => void
}) {
  return (
    <label className="ctl">
      <span className="ctl-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

export function Check({ label, value, onChange }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ctl check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="ctl-label">{label}</span>
    </label>
  )
}

/** Everything that isn't a property of one optical component. Component parameters live in the margin notes. */
export function Transport({ playing, onPlay, onStep, onReset, speed, setSpeed, t, ms, imageMode, setImageMode }: {
  playing: boolean; onPlay: () => void; onStep: () => void; onReset: () => void
  speed: number; setSpeed: (s: number) => void; t: number; ms: number
  imageMode: ImageMode; setImageMode: (m: ImageMode) => void
}) {
  return (
    <div className="transport">
      <button className="primary" onClick={onPlay}>{playing ? '❚❚ pause' : '▶ run'}</button>
      <button onClick={onStep}>step ↻</button>
      <button onClick={onReset}>reset</button>
      <label className="ctl">
        <span className="ctl-label">trips/s</span>
        <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <Select label="slices show" value={imageMode} onChange={setImageMode} options={[['intensity', '|E|²'], ['phase', 'phase · |E|']]} />
      <span className="counter">t = <b>{t}</b></span>
      <span className="counter">{ms.toFixed(0)} ms / trip</span>
    </div>
  )
}
