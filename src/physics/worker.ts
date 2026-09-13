/// <reference lib="webworker" />
import { Cavity, type ProbeSpec, type TripRec } from './cavity'
import type { Params } from './params'

export type ToWorker =
  | { type: 'init'; gen: number; params: Params; input: Float32Array; probe: ProbeSpec | null }
  | { type: 'live'; params: Params }
  | { type: 'step'; gen: number; count: number; probe: ProbeSpec | null }
  | { type: 'probe'; gen: number; probe: ProbeSpec }

export type FromWorker =
  | { type: 'trip'; gen: number; rec: TripRec }
  | { type: 'probe'; gen: number; probe: ProbeSpec; image: Float32Array }

let cav: Cavity | null = null
let gen = 0

function postTrip(rec: TripRec) {
  const transfer: Transferable[] = [
    rec.down.I.buffer, rec.down.cre.buffer, rec.down.cim.buffer, rec.down.cen.buffer, rec.down.wid.buffer,
    rec.up.I.buffer, rec.up.cre.buffer, rec.up.cim.buffer, rec.up.cen.buffer, rec.up.wid.buffer,
    rec.ccd.buffer, rec.ccdHistory.buffer, ...Object.values(rec.images).map((a) => a.buffer),
  ]
  self.postMessage({ type: 'trip', gen, rec } satisfies FromWorker, { transfer })
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      gen = m.gen
      cav = new Cavity(m.params, m.input)
      postTrip(cav.step(m.probe))
      break
    case 'live':
      cav?.setLive(m.params)
      break
    case 'step': {
      if (!cav || m.gen !== gen) return
      let rec: TripRec | null = null
      // only the last trip of a batch is sent back; intermediate ones just advance the state
      for (let i = 0; i < m.count; i++) rec = cav.step(i === m.count - 1 ? m.probe : null)
      if (rec) postTrip(rec)
      break
    }
    case 'probe': {
      if (!cav || m.gen !== gen) return
      const image = cav.probeImage(m.probe)
      self.postMessage({ type: 'probe', gen, probe: m.probe, image } satisfies FromWorker, { transfer: [image.buffer] })
      break
    }
  }
}
