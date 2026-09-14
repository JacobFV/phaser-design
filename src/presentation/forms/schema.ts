import type { ReactNode } from 'react'

/**
 * Presentation-side form descriptors. Each discriminated config type (element kind, medium kind, encoding, …) maps to
 * a descriptor list, so the UI shows only the controls that make sense for the selected type.
 */
export type Path = (string | number)[]

export function getAt(obj: unknown, path: Path): unknown {
  let cur = obj as Record<string | number, unknown> | undefined
  for (const k of path) cur = cur == null ? undefined : (cur[k] as typeof cur)
  return cur
}

/** Immutable set: copies every object/array along the path. */
export function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (!path.length) return value as T
  const [k, ...rest] = path
  const src = (obj ?? (typeof k === 'number' ? [] : {})) as Record<string | number, unknown>
  const copy = (Array.isArray(src) ? [...src] : { ...src }) as Record<string | number, unknown>
  copy[k] = setAt(src[k], rest, value)
  return copy as T
}

export type Unit = { label: string; scale: number } // display = SI value × scale

export const U = {
  m: { label: 'm', scale: 1 },
  mm: { label: 'mm', scale: 1e3 },
  um: { label: 'µm', scale: 1e6 },
  nm: { label: 'nm', scale: 1e9 },
  rad: { label: 'rad', scale: 1 },
  pi: { label: '$\\pi$ rad', scale: 1 / Math.PI },
  ms: { label: 'ms', scale: 1e3 },
  kPa: { label: 'kPa', scale: 1e-3 },
  K: { label: 'K', scale: 1 },
  perM: { label: '1/m', scale: 1 },
  none: { label: '', scale: 1 },
} satisfies Record<string, Unit>

export interface UnionVariant {
  label: string
  template: () => object // full default value for this variant (includes the discriminant)
  fields: FieldDescriptor[] // paths relative to the union value
}

export type FieldDescriptor =
  | { kind: 'number'; path: Path; label: string; unit?: Unit; min?: number; max?: number; step?: number; hint?: string }
  | { kind: 'fraction'; path: Path; label: string; hint?: string } // power fraction 0..1
  | { kind: 'integer'; path: Path; label: string; min?: number; max?: number; hint?: string }
  | { kind: 'boolean'; path: Path; label: string }
  | { kind: 'select'; path: Path; label: string; options: { value: string; label: string }[] }
  | { kind: 'text'; path: Path; label: string }
  | { kind: 'directional'; path: Path; label: string; hint?: string } // Directional<number> power fraction
  | { kind: 'vec2'; path: Path; label: string; unit: Unit }
  | { kind: 'union'; path: Path; label: string; discriminant: string; variants: Record<string, UnionVariant> }
  | { kind: 'group'; label: string; fields: FieldDescriptor[]; collapsed?: boolean }
  | { kind: 'custom'; label: string; render: (value: unknown, set: (path: Path, v: unknown) => void) => ReactNode }

/** Prefix every path in a descriptor list (used when nesting union variants and composite elements). */
export function prefixed(prefix: Path, fields: FieldDescriptor[]): FieldDescriptor[] {
  return fields.map((f) => {
    if (f.kind === 'group') return { ...f, fields: prefixed(prefix, f.fields) }
    if (f.kind === 'custom') return { ...f, render: (v, set) => f.render(getAt(v, prefix), (p, x) => set([...prefix, ...p], x)) }
    return { ...f, path: [...prefix, ...f.path] }
  })
}
