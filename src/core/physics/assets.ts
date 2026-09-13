import type { AssetRef } from './elements/types'

/**
 * Large arrays (phase masks, input images) live outside the JSON config. The config holds an AssetRef whose content hash
 * pins the exact data, so an experiment is reproducible even when the arrays are shipped separately.
 */
export interface Asset {
  ref: AssetRef
  data: Float64Array
}

export interface AssetResolver {
  get(ref: AssetRef): Float64Array
}

/** FNV-1a over the float64 bytes, two independent 32-bit lanes → 16 hex chars. Stable across platforms. */
export function hashArray(data: Float64Array, width: number, height: number): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let h1 = 0x811c9dc5 ^ width
  let h2 = 0x01000193 ^ height
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x811c9dc5) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export class AssetStore implements AssetResolver {
  private assets = new Map<string, Asset>()

  put(id: string, width: number, height: number, data: ArrayLike<number>): AssetRef {
    if (data.length !== width * height) throw new Error(`asset ${id}: expected ${width * height} values, got ${data.length}`)
    const arr = Float64Array.from(data)
    const ref: AssetRef = { id, width, height, hash: hashArray(arr, width, height) }
    this.assets.set(id, { ref, data: arr })
    return ref
  }

  add(asset: Asset): void {
    const hash = hashArray(asset.data, asset.ref.width, asset.ref.height)
    if (hash !== asset.ref.hash) throw new Error(`asset ${asset.ref.id}: content hash mismatch`)
    this.assets.set(asset.ref.id, asset)
  }

  get(ref: AssetRef): Float64Array {
    const a = this.assets.get(ref.id)
    if (!a) throw new Error(`asset ${ref.id} is not loaded`)
    if (a.ref.hash !== ref.hash || a.ref.width !== ref.width || a.ref.height !== ref.height)
      throw new Error(`asset ${ref.id}: loaded data (${a.ref.hash}) does not match reference (${ref.hash})`)
    return a.data
  }

  has(ref: AssetRef): boolean {
    const a = this.assets.get(ref.id)
    return !!a && a.ref.hash === ref.hash
  }

  list(): Asset[] {
    return [...this.assets.values()]
  }
}
