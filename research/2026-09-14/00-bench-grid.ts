// throwaway: round-trip cost vs grid size for a minimal 2-segment 4f relay ring
import { CompiledSystem } from '../../src/core/physics/system'
import { AssetStore } from '../../src/core/physics/assets'
import { NULL_CONTEXT } from '../../src/core/physics/elements/element'
import { createField } from '../../src/core/physics/field/grid'
for (const n of [32, 64, 128, 256]) {
  const f0 = 40e-3
  const sys = new CompiledSystem({
    field: { grid: { nx: n, ny: n, dx: 10e-6, dy: 10e-6 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.08 } },
    elements: [
      { kind: 'lens', id: 'L1', focalLength: f0, apertureDiameter: 1, transmission: { front: 1, back: 1 } },
      { kind: 'lens', id: 'L2', focalLength: f0, apertureDiameter: 1, transmission: { front: 1, back: 1 } },
    ],
    topology: { kind: 'custom', route: [
      { kind: 'element', elementId: 'L1', side: 'front' }, { kind: 'propagate', length: 2 * f0, medium: { kind: 'vacuum' } },
      { kind: 'element', elementId: 'L2', side: 'front' }, { kind: 'propagate', length: 2 * f0, medium: { kind: 'vacuum' } },
    ] },
    readouts: [],
  }, new AssetStore())
  const f = createField(sys.grid); f.re[n * n / 2 + n / 2] = 1
  for (let i = 0; i < 20; i++) sys.roundTrip(f, NULL_CONTEXT)
  const N = n <= 64 ? 2000 : 200
  const t0 = performance.now()
  for (let i = 0; i < N; i++) sys.roundTrip(f, NULL_CONTEXT)
  console.log(n, ((performance.now() - t0) / N).toFixed(3), 'ms/rt (2 segments)')
}
