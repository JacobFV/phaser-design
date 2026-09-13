import { AssetStore, hashArray } from '../physics/assets'
import type { AssetRef, MaskProgram, OpticalElementSpec } from '../physics/elements/types'
import type { SimulationConfig } from './config'

/**
 * Experiment files: the JSON config plus, optionally, embedded arrays. Arrays are always referenced by id + content
 * hash, so a config shipped without its arrays still pins exactly which data it needs.
 */
export interface ExperimentFile {
  format: 'phaser-experiment'
  version: 1
  config: SimulationConfig
  assets: { ref: AssetRef; data: string }[] // base64 of little-endian float64
}

function programsOf(e: OpticalElementSpec): MaskProgram[] {
  switch (e.kind) {
    case 'lcd-microlens': return [e.lcd.program]
    case 'lcos-slm': return e.aberration ? [e.program, e.aberration] : [e.program]
    case 'transmissive-lcd':
    case 'phase-plate': return [e.program]
    default: return []
  }
}

export function referencedAssets(config: SimulationConfig): AssetRef[] {
  const elements = [...config.physics.elements, ...config.physics.readouts.flatMap((r) => r.stages.flatMap((s) => (s.kind === 'element' ? [s.element] : [])))]
  const refs = elements.flatMap(programsOf).flatMap((p) => (p.kind === 'array' ? [p.ref] : []))
  return [...new Map(refs.map((r) => [`${r.id}:${r.hash}`, r])).values()]
}

function toBase64(data: Float64Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): Float64Array {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return new Float64Array(bytes.buffer)
}

export function exportExperiment(config: SimulationConfig, store: AssetStore, opts: { embedAssets: boolean }): string {
  const file: ExperimentFile = {
    format: 'phaser-experiment',
    version: 1,
    config,
    assets: opts.embedAssets ? referencedAssets(config).map((ref) => ({ ref, data: toBase64(store.get(ref)) })) : [],
  }
  return JSON.stringify(file, null, 2)
}

/** Parse an experiment, load embedded arrays (hash-verified) into `store`, and report referenced arrays still missing. */
export function importExperiment(json: string, store: AssetStore): { config: SimulationConfig; missing: AssetRef[] } {
  const file = JSON.parse(json) as Partial<ExperimentFile>
  if (file.format !== 'phaser-experiment' || file.version !== 1 || !file.config) throw new Error('not a phaser-experiment v1 file')
  if (file.config.version !== 1) throw new Error(`unsupported config version ${String(file.config.version)}`)
  for (const a of file.assets ?? []) {
    const data = fromBase64(a.data)
    if (hashArray(data, a.ref.width, a.ref.height) !== a.ref.hash) throw new Error(`asset ${a.ref.id} does not match its hash`)
    store.add({ ref: a.ref, data })
  }
  return { config: file.config, missing: referencedAssets(file.config).filter((r) => !store.has(r)) }
}
