import type { AlgorithmReadout, AlgorithmStatus } from '../algorithms/interfaces'
import type { GridSpec } from '../physics/field/grid'
import type { RouteTiming } from '../physics/system'
import type { Route } from '../physics/topology/topology'
import type { SideView } from './observation'

export interface DetectorSnapshot {
  id: string
  nx: number
  ny: number
  pixelSize: { x: number; y: number }
  intensity: Float32Array
  power: number
}

/**
 * Typed, transferable result of a step batch. Presentation renders these; it never reaches into the running
 * simulation. Arrays are Float32 copies safe to transfer across the worker boundary.
 */
export interface SimulationSnapshot {
  epoch: number // increments whenever the physical field is reset; lets consumers drop stale frames
  cycle: number
  time: number // physical time, s
  stepMs: number // wall time of the batch
  physics: {
    grid: GridSpec
    wavelength: number
    meanIntensity: number
    power: number
    energyHistory: Float64Array // mean intensity per cycle, oldest first
    timing: RouteTiming
    route: Route
    budget: { index: number; label: string; transmission: number }[]
    elementStates: Record<string, Record<string, number>>
    warnings: string[]
    field?: Float32Array
    stepFields: Record<number, Float32Array>
    taps: Record<string, Float32Array>
    readouts: DetectorSnapshot[]
    sideView?: SideView
    probe?: Float32Array
  }
  computation: {
    ports: Record<string, number[]>
    regionPower: Record<string, number> // fraction of circulating power inside each region
    warnings: string[]
  }
  algorithm: {
    module: string
    status: AlgorithmStatus
    readout: AlgorithmReadout
    error?: string
  }
}

export function snapshotTransferables(s: SimulationSnapshot): ArrayBuffer[] {
  const bufs: ArrayBuffer[] = [s.physics.energyHistory.buffer as ArrayBuffer]
  const add = (a?: Float32Array) => a && bufs.push(a.buffer as ArrayBuffer)
  add(s.physics.field)
  add(s.physics.probe)
  Object.values(s.physics.stepFields).forEach(add)
  Object.values(s.physics.taps).forEach(add)
  s.physics.readouts.forEach((r) => add(r.intensity))
  if (s.physics.sideView) {
    for (const seg of s.physics.sideView.segments) for (const r of seg.rows) bufs.push(r.I.buffer as ArrayBuffer, r.re.buffer as ArrayBuffer, r.im.buffer as ArrayBuffer)
    for (const r of Object.values(s.physics.sideView.after)) bufs.push(r.I.buffer as ArrayBuffer, r.re.buffer as ArrayBuffer, r.im.buffer as ArrayBuffer)
  }
  return [...new Set(bufs)]
}
