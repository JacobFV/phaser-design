// Every form descriptor must point at a value that exists in the template it edits; a wrong path crashes the panel.
import { describe, expect, it } from 'vitest'
import { newPort, newRegion, portFields, regionFields } from '../src/presentation/forms/computationSchemas'
import { ELEMENT_KINDS } from '../src/presentation/forms/elementSchemas'
import { getAt, type FieldDescriptor, type Path } from '../src/presentation/forms/schema'

/** Collect paths that resolve to undefined, descending into groups and every union variant (via its template). */
function missingPaths(value: unknown, fields: FieldDescriptor[], prefix: Path = []): string[] {
  const out: string[] = []
  for (const f of fields) {
    switch (f.kind) {
      case 'group':
        out.push(...missingPaths(value, f.fields, prefix))
        break
      case 'custom':
      case 'text': // text fields may be optional (e.g. tap ids)
        break
      case 'union': {
        const current = getAt(value, f.path)
        if (current === undefined) out.push([...prefix, ...f.path].join('.'))
        for (const [key, variant] of Object.entries(f.variants)) {
          const template = variant.template() as Record<string, unknown>
          if (template[f.discriminant] !== key && key !== 'array') out.push(`${[...prefix, ...f.path].join('.')} variant ${key}: template discriminant is ${String(template[f.discriminant])}`)
          out.push(...missingPaths(template, variant.fields, [...prefix, ...f.path, `<${key}>`]))
        }
        break
      }
      default:
        if (getAt(value, f.path) === undefined) out.push([...prefix, ...f.path].join('.'))
    }
  }
  return out
}

describe('form schemas', () => {
  for (const k of ELEMENT_KINDS) {
    it(`${k.kind} fields resolve against its template`, () => {
      expect(missingPaths(k.template('x'), k.fields)).toEqual([])
    })
  }

  it('region and port fields resolve against their templates', () => {
    expect(missingPaths(newRegion('r'), regionFields)).toEqual([])
    expect(missingPaths(newPort('p', 'r'), portFields(['r']))).toEqual([])
  })
})
