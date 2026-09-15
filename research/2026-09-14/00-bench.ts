// throwaway: cost per round trip and route timing for each preset
import { PRESETS } from '../../src/core/runtime/presets'
import { CompiledSystem } from '../../src/core/physics/system'
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField } from '../../src/core/physics/field/grid'
import { analyticMetrics } from '../../src/core/physics/metrics/analytic'
for (const p of PRESETS) {
  const cfg = p.build()
  const sys = new CompiledSystem(cfg.physics, new AssetStore())
  const f = createField(sys.grid); f.re[f.re.length / 2 + sys.grid.nx / 2] = 1
  for (let i = 0; i < 20; i++) sys.roundTrip(f, NULL_CONTEXT)
  const t0 = performance.now(); const N = 200
  for (let i = 0; i < N; i++) sys.roundTrip(f, NULL_CONTEXT)
  const ms = (performance.now() - t0) / N
  const props = sys.route.steps.filter((s) => s.kind === 'propagate').length
  const m = Object.fromEntries(analyticMetrics(sys).map((x) => [x.key, x.value]))
  console.log(`${p.id.padEnd(16)} grid ${sys.grid.nx} dx ${(sys.grid.dx*1e6).toFixed(2)}µm props/rt ${props} ms/rt ${ms.toFixed(2)} t_rt ${(sys.timing().roundTripTime*1e9).toFixed(3)} ns f_rt ${(sys.timing().roundTripFrequency/1e6).toFixed(2)} MHz passive ${m.passiveRetention.toFixed(4)} G0 ${m.smallSignalGain} wStable ${(m.minWaistOneTrip*1e6).toFixed(0)}µm`)
  console.log('   ', sys.warnings().join(' | '))
}
