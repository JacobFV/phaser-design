import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterizationRequest, CharacterizationResult } from '../../core/computation/analysis/characterize'
import type { AssetRef, MaskProgram } from '../../core/physics/elements/types'
import type { Metric } from '../../core/physics/metrics/analytic'
import type { ConfigChange, ResetScope, SimulationConfig } from '../../core/runtime/config'
import type { ObservationRequest } from '../../core/runtime/observation'
import type { SimulationSnapshot } from '../../core/runtime/snapshots'
import type { FromWorker, ToWorker } from '../../worker/protocol'

export interface CharacterizationJob {
  jobId: number
  done: number
  total: number
  result?: CharacterizationResult
}

export interface SimulationHandle {
  config: SimulationConfig
  snapshot: SimulationSnapshot | null
  previous: SimulationSnapshot | null
  metrics: Metric[]
  lastChange: { applied: ResetScope[]; change: ConfigChange } | null
  errors: string[]
  busy: boolean
  job: CharacterizationJob | null
  load: (config: SimulationConfig) => void
  configure: (config: SimulationConfig, reset?: ResetScope[]) => void
  step: (count: number, observe: ObservationRequest) => boolean
  observe: (observe: ObservationRequest) => void
  reset: (scopes: ResetScope[]) => void
  setProgram: (elementId: string, program: MaskProgram, preserveField: boolean) => void
  writePort: (port: string, values: number[], mode: 'pulse' | 'continuous') => void
  putAsset: (id: string, width: number, height: number, data: Float64Array) => Promise<AssetRef>
  characterize: (request: CharacterizationRequest) => void
  dismissError: (i: number) => void
}

/**
 * Owns the simulation worker. React only sends configuration/commands and receives snapshots; all state that matters
 * for results lives in the worker.
 */
export function useSimulation(initial: SimulationConfig): SimulationHandle {
  const worker = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const snapshotRef = useRef<SimulationSnapshot | null>(null)
  const requestId = useRef(0)
  const jobId = useRef(0)
  const assetWaiters = useRef(new Map<string, (ref: AssetRef) => void>())
  const [config, setConfig] = useState(initial)
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null)
  const [previous, setPrevious] = useState<SimulationSnapshot | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [lastChange, setLastChange] = useState<SimulationHandle['lastChange']>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<CharacterizationJob | null>(null)

  const post = useCallback((msg: ToWorker, transfer: Transferable[] = []) => worker.current?.postMessage(msg, transfer), [])

  useEffect(() => {
    const w = new Worker(new URL('../../worker/simulationWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      switch (m.type) {
        case 'snapshot': {
          busyRef.current = false
          setBusy(false)
          setConfig(m.config)
          const prev = snapshotRef.current
          // a previous frame is only meaningful for the same physical field history
          setPrevious(prev && prev.epoch === m.snapshot.epoch ? prev : null)
          snapshotRef.current = m.snapshot
          setSnapshot(m.snapshot)
          break
        }
        case 'configured':
          setLastChange({ applied: m.applied, change: m.change })
          break
        case 'metrics':
          setMetrics(m.metrics)
          break
        case 'asset':
          assetWaiters.current.get(m.ref.id)?.(m.ref)
          assetWaiters.current.delete(m.ref.id)
          break
        case 'characterize-progress':
          setJob((j) => (j && j.jobId === m.jobId ? { ...j, done: m.done, total: m.total } : j))
          break
        case 'characterize-result':
          setJob((j) => (j && j.jobId === m.jobId ? { ...j, done: j.total, result: m.result } : j))
          break
        case 'error':
          busyRef.current = false
          setBusy(false)
          setErrors((es) => [...es.slice(-4), `${m.context}: ${m.message}`])
          break
      }
    }
    w.postMessage({ type: 'load', config: initial, assets: [] } satisfies ToWorker)
    return () => w.terminate()
    // the worker lives for the lifetime of the hook; later configs go through `load` / `configure`
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback((c: SimulationConfig) => {
    setConfig(c)
    snapshotRef.current = null
    setSnapshot(null)
    setPrevious(null)
    post({ type: 'load', config: c, assets: [] })
  }, [post])

  const configure = useCallback((c: SimulationConfig, reset?: ResetScope[]) => {
    setConfig(c)
    post({ type: 'configure', config: c, reset })
  }, [post])

  const step = useCallback((count: number, observe: ObservationRequest) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    post({ type: 'step', count, observe, requestId: ++requestId.current })
    return true
  }, [post])

  const observe = useCallback((o: ObservationRequest) => post({ type: 'observe', observe: o, requestId: ++requestId.current }), [post])
  const reset = useCallback((scopes: ResetScope[]) => post({ type: 'reset', scopes }), [post])
  const setProgram = useCallback((elementId: string, program: MaskProgram, preserveField: boolean) => post({ type: 'set-program', elementId, program, preserveField }), [post])
  const writePort = useCallback((port: string, values: number[], mode: 'pulse' | 'continuous') => post({ type: 'write-port', port, values, mode }), [post])

  const putAsset = useCallback((id: string, width: number, height: number, data: Float64Array) =>
    new Promise<AssetRef>((resolve) => {
      assetWaiters.current.set(id, resolve)
      post({ type: 'put-asset', id, width, height, data })
    }), [post])

  const characterize = useCallback((request: CharacterizationRequest) => {
    const id = ++jobId.current
    setJob({ jobId: id, done: 0, total: request.sigmas.length + 1 })
    post({ type: 'characterize', jobId: id, request })
  }, [post])

  const dismissError = useCallback((i: number) => setErrors((es) => es.filter((_, k) => k !== i)), [])

  return { config, snapshot, previous, metrics, lastChange, errors, busy, job, load, configure, step, observe, reset, setProgram, writePort, putAsset, characterize, dismissError }
}
