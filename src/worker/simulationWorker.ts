/// <reference lib="webworker" />
import { createDefaultRegistry } from '../core/algorithms/registry'
import { characterize } from '../core/computation/analysis/characterize'
import { AssetStore } from '../core/physics/assets'
import { analyticMetrics } from '../core/physics/metrics/analytic'
import type { ObservationRequest } from '../core/runtime/observation'
import { Simulation } from '../core/runtime/simulation'
import { snapshotTransferables } from '../core/runtime/snapshots'
import type { FromWorker, ToWorker } from './protocol'

/** Hosts the headless core runtime off the UI thread. */
let sim: Simulation | null = null
const assets = new AssetStore()
const registry = createDefaultRegistry()

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

function sendSnapshot(requestId: number | null) {
  if (!sim) return
  const snapshot = sim.snapshot()
  post({ type: 'snapshot', requestId, snapshot, config: structuredClone(sim.config) as typeof sim.config }, snapshotTransferables(snapshot))
}

function sendMetrics() {
  if (sim) post({ type: 'metrics', metrics: analyticMetrics(sim.system) })
}

function guard(context: string, fn: () => void) {
  try {
    fn()
  } catch (e) {
    post({ type: 'error', message: (e as Error).message, context })
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  switch (m.type) {
    case 'load':
      guard('load', () => {
        for (const a of m.assets) assets.put(a.ref.id, a.ref.width, a.ref.height, a.data)
        sim = new Simulation(m.config, { assets, algorithms: registry })
        sendMetrics()
        sim.step(0)
        sendSnapshot(null)
      })
      break
    case 'configure':
      guard('configure', () => {
        if (!sim) return
        const { applied, change } = sim.configure(m.config, { reset: m.reset })
        post({ type: 'configured', applied, change })
        sendMetrics()
        sendSnapshot(null)
      })
      break
    case 'step':
      guard('step', () => {
        if (!sim) return
        sim.step(m.count, m.observe as ObservationRequest)
        sendSnapshot(m.requestId)
      })
      break
    case 'observe':
      // re-run nothing: report the current state with fresh port/algorithm readouts
      guard('observe', () => sendSnapshot(m.requestId))
      break
    case 'reset':
      guard('reset', () => {
        sim?.reset(m.scopes)
        sendSnapshot(null)
      })
      break
    case 'set-program':
      guard('set-program', () => {
        sim?.setProgram(m.elementId, m.program, { preserveField: m.preserveField })
        sendSnapshot(null)
      })
      break
    case 'write-port':
      guard('write-port', () => sim?.writePort(m.port, m.values, m.mode))
      break
    case 'put-asset':
      guard('put-asset', () => post({ type: 'asset', ref: assets.put(m.id, m.width, m.height, m.data) }))
      break
    case 'characterize':
      guard('characterize', () => {
        if (!sim) return
        const result = characterize(structuredClone(sim.config.physics), assets, m.request, (done, total) =>
          post({ type: 'characterize-progress', jobId: m.jobId, done, total }),
        )
        post({ type: 'characterize-result', jobId: m.jobId, result })
      })
      break
  }
}
