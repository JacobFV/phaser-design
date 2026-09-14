import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', 'src', 'core')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : []
  })
}

const imports = (src: string) => [...src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

/** Drop block and line comments so prose ("the simulation window.") can't trip the code checks. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('layer separation', () => {
  const all = files(ROOT).map((p) => ({ path: relative(ROOT, p), src: stripComments(readFileSync(p, 'utf8')) }))

  it('the core imports no UI framework, DOM or presentation code', () => {
    for (const f of all) {
      for (const spec of imports(f.src)) {
        expect(spec, f.path).not.toMatch(/^react(-dom)?(\/|$)/)
        expect(spec, f.path).not.toMatch(/presentation|\/app\//)
      }
      expect(f.src, f.path).not.toMatch(/\bdocument\.|\bwindow\.|HTMLCanvasElement|getContext\(/)
    }
  })

  it('physics never imports computation, algorithms or runtime', () => {
    for (const f of all.filter((f) => f.path.startsWith('physics')))
      for (const spec of imports(f.src)) expect(spec, f.path).not.toMatch(/computation|algorithms|runtime/)
  })

  it('computation never imports algorithms or runtime', () => {
    for (const f of all.filter((f) => f.path.startsWith('computation')))
      for (const spec of imports(f.src)) expect(spec, f.path).not.toMatch(/algorithms|runtime/)
  })

  it('common utilities depend on no semantic layer', () => {
    for (const f of all.filter((f) => f.path.startsWith('common')))
      for (const spec of imports(f.src)) expect(spec, f.path).not.toMatch(/physics|computation|algorithms|runtime/)
  })

  it('algorithms reach physics only through the computation layer', () => {
    for (const f of all.filter((f) => f.path.startsWith('algorithms')))
      for (const spec of imports(f.src)) expect(spec, f.path).not.toMatch(/physics|runtime/)
  })
})
