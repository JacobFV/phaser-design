import { useEffect, useState, type ReactNode } from 'react'

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return String(v)
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3)
  return String(Number(v.toPrecision(6)))
}

/** Number field that keeps a local draft and commits on blur / Enter, so typing never spams the simulation. */
export function NumberInput({ value, onCommit, min, max, step, width = 84 }: {
  value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; width?: number
}) {
  const [draft, setDraft] = useState(fmt(value))
  useEffect(() => setDraft(fmt(value)), [value])
  const commit = () => {
    const v = Number(draft)
    if (!Number.isFinite(v)) return setDraft(fmt(value))
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
    if (c !== value) onCommit(c)
    setDraft(fmt(c))
  }
  return (
    <input
      className="num" style={{ width }} value={draft} inputMode="decimal" step={step}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  )
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function FractionInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <span className="fraction">
      <input type="range" min={0} max={1} step={0.001} value={value} onChange={(e) => onCommit(Number(e.target.value))} />
      <NumberInput value={value} onCommit={onCommit} min={0} max={1} width={64} />
    </span>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string }[]; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ kind }: { kind: string }) {
  return <span className={`badge badge-${kind}`}>{kind}</span>
}
