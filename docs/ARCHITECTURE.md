# PHASER simulator architecture

PHASER is a compositional simulator and runtime for recurrent optical architectures. It is organised as three
independently configurable semantic layers, a runtime that coordinates them, and a presentation layer that only
renders their output.

```text
            configure / compile                           observe / decode
 ┌───────────────────────────┐                 ┌──────────────────────────────────┐
 │ algorithmic state          │  ports, programs│ algorithm readout (bits, energy…)│
 │ (workload: memory, relax…) │ ───────────────▶│                                  │
 └────────────┬──────────────┘                 └───────────────▲──────────────────┘
              │ encode values into regions                      │ decode regions into values
 ┌────────────▼──────────────┐                 ┌───────────────┴──────────────────┐
 │ computational state        │                 │ port values, region power,       │
 │ (regions, cells, encodings)│                 │ cross-talk, stability metrics    │
 └────────────┬──────────────┘                 └───────────────▲──────────────────┘
              │ inject fields at physical ports                 │ read fields / detector images
 ┌────────────▼──────────────┐                 ┌───────────────┴──────────────────┐
 │ physical state             │ ─── round trip ▶│ circulating field, taps, readouts│
 │ (complex field, elements,  │                 │ timing, power budget             │
 │  route, media)             │                 └──────────────────────────────────┘
 └───────────────────────────┘
```

Physics never knows what a blob *means*; computation never knows which *algorithm* uses it; algorithms never touch FFT
buffers or element models. Presentation consumes typed snapshots and never feeds back into results.

## Source layout and dependency rules

```text
src/
  core/
    physics/        fields, FFT, propagation kernels, media, elements, topology, system (route engine), metrics
    computation/    regions, encodings, ports (regions.ts), analysis/characterize.ts
    algorithms/     plugin interface, pure patterns, demonstrator modules, registry
    runtime/        SimulationConfig + reset scopes, Simulation, observation, snapshots, presets, serialisation
  worker/           protocol + worker host running core/runtime
  presentation/     hooks, forms (schema-driven), panels, layouts, renderers, components
  app/              composition of the UI
examples/           headless experiment authoring
tests/              deterministic core tests (vitest)
```

Enforced by `tests/separation.test.ts`:

- `core/**` imports no React, DOM or presentation code.
- `core/physics` never imports computation, algorithms or runtime.
- `core/computation` never imports algorithms or runtime.
- `core/algorithms` reaches physics types only through `core/computation/index.ts`.
- The runtime coordinates all three. The worker hosts the runtime. React only configures it and renders snapshots.

## Units and normalisation

| quantity | convention |
|---|---|
| length, time, phase | metres, seconds, radians |
| field sample `E` | complex amplitude in √(W/m²) (arbitrary but consistent scale) |
| power | `P = Σ|E|²·dx·dy` |
| mean intensity | `Σ|E|² / (nx·ny)` (used by global gain saturation) |
| `transmission`, `reflectivity`, `retained`, `inputCoupling` | **power** fractions; elements take √ internally |
| attenuation `α` | power: `P(L) = P(0)·e^{−αL}` |
| FFT | forward unnormalised, inverse ÷ n. A unit-modulus kernel conserves Σ|E|² |

Sample `(i, j)` sits at `x = (i − nx/2 + ½)·dx`, so the grid is centred on the optical axis. `nx` and `ny` must be
powers of two.

## Physics

### Field, sampling and boundary

`PhysicsConfig.field = { grid: {nx, ny, dx, dy}, wavelength, boundary }`. Grid resolution is configuration; there are
no global size constants.

`boundary` is a physical/numerical choice:

- `absorbing`: a cosine taper of the outer `widthFraction`, applied after every propagation segment. Light reaching
  the edge is removed. This is the default for new experiments.
- `periodic`: raw FFT wraparound. Select it only when the system really is periodic, or as a deliberate idealisation;
  otherwise wraparound masquerades as spatial coupling. The PHASER chamber preset selects it explicitly, as an
  idealisation of lossless side walls.

### Propagation and media

Free space uses the scalar angular-spectrum method
`H = exp(i(k_z − k)L)·exp(−αL/2)`, with `k = 2πn/λ` and `k_z = √(k² − k_x² − k_y²)`. Because `k_z` does not
separate in x and y, diagonal spatial frequencies are handled correctly. The on-axis carrier `e^{ikL}` is removed; it
is common to the whole single route, and optical path is tracked separately for timing. Kernels are cached by
`(grid, λ, L, n, α)`, so repeated identical segments share one.

`MediumSpec` is a discriminated union resolved to `(n, n_g, α)`:

| kind | parameters | model |
|---|---|---|
| `vacuum` | none | n = n_g = 1, α = 0 |
| `air` | pressure, temperature, α | Edlén dispersion scaled by density; n_g from the dispersion slope |
| `gas` | gas id, pressure, temperature, α | tabulated refractivity scaled by density; n_g ≈ n |
| `custom` | n, n_g, α, optional GVD | as given |

This is intentionally not a spectroscopy database.

### Optical elements

Specs (`core/physics/elements/types.ts`) are JSON data. Models (`models.ts`) implement:

```ts
interface OpticalElement {
  id; spec; linear; warnings
  apply(field, side: 'front' | 'back', ctx: RunContext): void   // in-place transfer
  powerTransmission(side): number                               // passive small-signal, for metrics
  state(); resetState()
  loadProgram?(program)                                         // programmable devices
  internalPath?: { length; groupIndex }                         // hidden optical path, counted in timing
}
```

Available kinds: `mirror`, `coupler`, `lens`, `microlens-array`, `aperture`, `lcos-slm`, `transmissive-lcd`,
`lcd-microlens`, `phase-plate`, `gain`, `nonlinear`. Readout chains reuse the same element models.

**Programmable devices.**

- **Pixel mapping.** Each device maps field samples to pixels, honouring pitch, fill factor and panel offset. Samples
  in the dead zone between pixels, or outside the panel, get their own transmission.
- **Commanded phase.** A program's phase is wrapped, clipped to the usable stroke, quantised, passed through the
  calibration curve (`linear` / `gamma` / `lut`), and scaled by `λ_design/λ`.
- **Program sources.** `MaskProgram` is `zero | random | grating | lenslets | array`. The procedural kinds are
  convenience presets. `array` is the general interface: an `AssetRef {id, width, height, hash}` resolved from an
  `AssetStore` and verified against its content hash.

**Nonlinearity and gain** are ordinary elements, so their location, strength and number of occurrences are all
configurable:

- `gain`: small-signal power gain, saturation `none | global | local`, noise `none | additive-gaussian`
  (disabled by default).
- `nonlinear`: local `E' = g(|E|²)·exp(iφ(|E|²))·E`, with a saturable amplitude and Kerr or saturable-Kerr phase.

These are simple models; nothing here claims they are sufficient for arbitrary neural computation.

### Directional (front/back) behaviour

Every route step names the incident face. Any property that can differ between faces is a `Directional<T>`:

- LCD entrance surfaces (transmission and reflection per face)
- mirror and coupler reflectivities
- lens, MLA and phase-plate transmission

Other face-dependent behaviour:

- **LCOS:** the back face is opaque silicon.
- **LCD + microlens composite:** applies `LCD → gap → MLA` from the front and `MLA → gap → LCD` from the back. The
  gap is a real propagation, so the order matters.

A reverse traversal never silently reuses forward behaviour. Surface reflections are treated as loss; ghost beams are
not recirculated.

### Topology

`TopologySpec` compiles to an explicit `Route`: an ordered list of
`{kind: 'element', elementId, side}` and `{kind: 'propagate', length, medium}` steps, each carrying its distance along
the route. The engine (`CompiledSystem.roundTrip`) only iterates that list, so it cannot tell a rectangle from a folded
path.

| kind | meaning |
|---|---|
| `ring` | closed unidirectional route of legs; items positioned along each leg, a corner element at each leg's end, all entered from the front. `rectangularRing()` builds four explicit legs with equal left/right lengths unless overridden. |
| `linear-reciprocal` | start assembly → items forward (front faces) → end assembly → items in reverse (back faces). Every segment is traversed twice. Assemblies are thin elements applied once per reflection. `linearStack()` spaces items evenly. |
| `custom` | any explicit sequence of element visits (with faces) and propagations. |

Mirror image parity (`flip-x`, `flip-y`) is explicit on mirrors; transverse coordinates are otherwise in the route's
frame.

### Timing, loss and readout

`CompiledSystem.timing()` walks the actual route: `t_rt = Σ n_g,i·L_i / c` over every propagation step, plus composite
internal paths, and `f_rt = 1/t_rt`. `powerBudget()` gives each step's passive power transmission. Nothing uses
`N·d_sep`.

Readouts are chains fed by taps (coupler `outputTap`). Each is a list of element/propagation stages followed by a
detector, either `near-field` or an ideal `fourier-plane` lens with physical pixel size `λf/(N·dx)`, optionally
binned. Readouts never feed back into the cavity.

### Replacing numerical kernels

The hot path is `fft2` plus `applyKernel` inside `CompiledSystem.roundTrip`, and elements multiplying precomputed
per-sample transmissions. A WebGPU or WASM backend can replace `field/fft.ts`, `propagation/angularSpectrum.ts` and
the element `apply` bodies behind the same interfaces. A future Jones-vector field can add components alongside
`re/im` without changing `GridSpec`, routes or configs.

## Computation

`ComputationConfig = { regions, ports }` (`core/computation/regions.ts`).

- **Regions.** A `ComputationalRegionSpec` is a rectangle or circle split into `cells.x × cells.y`, with an encoding
  and a free-form `role` label that the core never interprets.
- **Encodings.** Each implements encode (values → field contribution) and decode (field or detector image → values):

| encoding | decode | encode |
|---|---|---|
| `intensity` | mean \|E\|² per cell | amplitude √v |
| `amplitude` | √(mean \|E\|²) | real amplitude v |
| `phase` | arg Σ E per cell | e^{iv} |
| `complex` | mean E (2 values per cell) | v_re + i·v_im |
| `differential-intensity` | (I₊ − I₋)/(I₊ + I₋) across the cell halves | √((1±v)/2) |
| `blob-mode` | power in a Gaussian mode (rms σ) on each cell | Σ v·g |

- **Input ports** bind a region to a physical coupler `inputPort`, with optional normalisation.
- **Output ports** read the circulating field, a tap, or a detector readout. Readout sources accept intensity-type
  encodings only, and their region bounds are in detector-plane coordinates.

## Algorithms

`AlgorithmModule` (`core/algorithms/interfaces.ts`) declares:

- parameter descriptors, which the UI renders generically
- required regions, ports and programmable elements
- a cadence in cycles
- `init`, `update`, `readout` and `status`

It sees only `AlgorithmContext`: region info, port read/write, programmable element list, `loadProgram`, `putAsset` and
`requestFieldReset`.

**Static logic, persistent data.** A loaded program stays fixed while the field evolves for `cadence` cycles
(10⁴–10⁶ in a real device). `update` runs between those blocks inside the worker. Algorithm progress never depends on
React updating masks every optical cycle. Updates run before cycles `c > 0` with `c % cadence == 0`.

Demonstrators (`core/algorithms/presets/`):

| module | what it shows | honest scope |
|---|---|---|
| `static-pattern` | inject a pattern once or continuously; free evolution; shape correlation | no update logic |
| `cellular-memory` | bits as light in cells; bit-error rate over recurrence; optional Game-of-Life step | the rule is computed electronically at the slow cadence |
| `hopfield-relaxation` | corrupted cue relaxes to a stored attractor | `W·s` is electronic; optics hold and transform the state between updates |

Patterns (`patterns.ts`) are pure, including a 5×7 bitmap font, so text inputs reproduce without a browser canvas.

## Runtime

### Configuration

```ts
interface SimulationConfig { version: 1; name?; physics; computation; algorithm; runtime }
```

Everything in it is JSON-serialisable. Presentation state (view settings, sweep animation, selection, probe
placement) is not part of it.

### State lifecycle and reset scopes

Runtime state is split into: physical (field, cycle, time, pending inputs, element state), computational (compiled
regions), algorithmic (module state), and presentation (React only).

`Simulation.configure(next, {reset?})` diffs configs and rebuilds only what changed:

| change | rebuild | required reset |
|---|---|---|
| grid or wavelength | physics + regions | `physical-field`, `computation` |
| topology, element parameters, media, readouts, boundary | optical operators | none: the field is kept |
| mask program only | `loadProgram` into the live device | none |
| computation config | regions/ports | `computation` |
| algorithm config | module | `algorithm` |
| presentation settings | nothing (not in config) | none |

A requested scope can add resets but never remove required ones. `reset(scope)` accepts
`none | physical-field | computation | algorithm | full`. Other lifecycle operations:

- `setProgram(id, program, {preserveField})` loads programs live.
- `writePort` and `injectField` queue pulse or continuous inputs without touching the circulating state.
- `stopPort` ends a continuous input.

### Observation and snapshots

`step(count, observe)` runs `count` cycles and records observations only during the last one:

- side-view projections at `samplesPerSegment` depths
- full fields after selected steps
- a probe inside any propagation step
- taps and readouts

Observers read the field and never write it (`tests/persistence.test.ts` checks bit-identical results).
`snapshot()` returns a `SimulationSnapshot` of Float32 copies safe to transfer. It carries an `epoch` that increments
on physical resets.

### Presets and serialisation

`core/runtime/presets.ts` contains plain configs:

- the PHASER chamber (four transmissive LCDs between an input coupler and a gain-carrying readout coupler)
- a reflective SLM ring with relay lenses
- a transmissive LCD linear cavity
- an LCD + microlens stack with static DOE mixers
- a low-loss idealised cavity

`exportExperiment`/`importExperiment` wrap a config with optionally embedded arrays (base64 float64, hash-verified).
Configs shipped without arrays still pin exactly which data they need.

## Metrics

Every metric carries `kind`:

- `analytical`: closed form from configuration (`core/physics/metrics/analytic.ts`). Examples: route timing, passive
  retention, loop gain and `ln G` per cycle, grid NA, free-space waist growth, pixel diffraction angle, coupling
  radius, efferent pixels, mode counts, mask update rate, readout bandwidth.
- `numerical`: measured by running the solver (live state, characterisation).
- `asymptotic`: long-time estimate (dominant eigenmode by power iteration, linear routes only).

Capacity is reported as distinct quantities that must not be conflated:

- physical field samples
- programmable modulator pixels
- effective spatial modes: aperture × (2·f_c)², with f_c limited by grid and pixel sampling
- stable computational states: analytic free-space estimate and numerical characterisation
- transient states at horizon N

Throughput proxies are labelled for what they are: field-sample updates/s, effective-mode updates/s, and local coupling
interactions/s (pixels × efferents × round trips/s). None is called a FLOP.

## Stable vs transient states

`core/computation/analysis/characterize.ts` launches a Gaussian blob (intensity rms radius σ) into the route with no
input and no algorithm. Each cycle it records energy, centroid, rms width, FWHM, intensity-shape correlation, complex
fidelity, leakage outside the blob's cell and cross-talk into neighbouring cells.

With configurable `StabilityThresholds`:

- **Transient at horizon N:** shape correlation ≥ threshold at cycle N, plus some tested separation meeting the
  leakage and cross-talk limits.
- **Stable (finite-horizon numerical):** transient at the longest horizon, AND trailing-window width and centroid
  drift per cycle ≤ ε, AND (optionally) energy in a bounded regime.
- **Minimum stable σ:** smallest tested σ that is stable. The result reports `monotonic: false` when the pass/fail
  pattern is not a clean threshold.
- **Density:** `1/s²` per mm² and `aperture/s²` for the minimum qualifying separation `s`, per horizon.

Numerical simulation never proves infinite-time stability; results always name their horizon. For linear routes a
separate asymptotic eigenmode estimate reports |λ| and mode width. Analytical predictions (for example the free-space
waist growing ≤ 1 % per trip) are shown alongside, so you can see where simple formulas stop working.

## Presentation

`presentation/hooks/useSimulation.ts` owns the worker: `load`, `configure`, `step`, `reset`, `setProgram`, `writePort`,
`putAsset` and `characterize`, with snapshots and metrics coming back.

Renderers derive geometry from the compiled route plus config:

- `ChamberRenderer` (via `layouts/chamberLayout.ts`) draws linear-reciprocal routes as the folded two-lane chamber.
- `RouteRenderer` (via `layouts/routeLayout.ts`) draws any route unfolded, with ring legs and a mini-map.

Solver correctness never depends on SVG coordinates, canvas size, animation progress or the displayed carrier
wavelength.

Forms are schema-driven (`presentation/forms/`). Each discriminated type maps to a `FieldDescriptor[]`, so selecting
a kind shows only its controls. The sidebar has Physics / Computation / Algorithm tabs; Analysis and Runtime &
Experiment are a separate area.

## How to…

### Add a modulator (or any element)

1. Add a spec interface to `core/physics/elements/types.ts` and include it in `OpticalElementSpec`. Use
   `Directional<T>` for anything face-dependent. If it takes programs, add it to `ProgrammableElementSpec`,
   `isProgrammable`, `programOf` and `withProgram`.
2. Implement an `OpticalElement` in `core/physics/elements/models.ts`. Precompute per-sample transmissions in the
   constructor or `loadProgram`, and keep `apply` allocation-free. Report `powerTransmission(side)` and any
   `internalPath`.
3. Add a case to `buildElement`.
4. Add an entry (template + fields) to `ELEMENT_KINDS` in `presentation/forms/elementSchemas.tsx`.
5. Add deterministic tests in `tests/elements.test.ts`: front vs back behaviour, and power vs amplitude.

### Add a medium

Add a variant to `MediumSpec` and a case to `resolveMedium` in `core/physics/media/media.ts` returning `(n, n_g, α)`,
then add the variant to `mediumField` in `presentation/forms/commonSchemas.tsx`.

### Add an algorithm

Implement `AlgorithmModule` using only `AlgorithmContext`, and register it with an `AlgorithmRegistry` (or
`createDefaultRegistry`). Declare the regions and ports it needs; the computation config provides them. The UI renders
its params automatically. No physics code changes are needed.

## Experiment authoring (headless)

```ts
import { createDefaultRegistry } from './src/core/algorithms/registry'
import { linearStack } from './src/core/physics/topology/builders'
import { Simulation } from './src/core/runtime/simulation'

const sim = new Simulation({
  version: 1,
  physics: {
    field: { grid: { nx: 128, ny: 128, dx: 31.75e-6, dy: 31.75e-6 }, wavelength: 650e-9, boundary: { kind: 'absorbing', widthFraction: 0.06 } },
    elements: [/* coupler 'in' with inputPort, LCDs, gain, mirror 'end' */],
    topology: linearStack({ elementIds: ['lcdA', 'lcdB'], spacing: 5e-3, medium: { kind: 'vacuum' }, start: ['in'], end: ['end'] }),
    readouts: [],
  },
  computation: { regions: [/* … */], ports: [/* … */] },
  algorithm: { module: 'cellular-memory', params: { generationCycles: 50 } },
  runtime: { seed: 1, historyLength: 1000 },
}, { algorithms: createDefaultRegistry() })

sim.step(10_000)                        // no React, no DOM
console.log(sim.snapshot().algorithm.readout)
```

`examples/headless-experiment.ts` (`npm run example`) is a complete version: a custom inline algorithm module, a live
mask change that preserves state, route metrics, characterisation and export.

## Known limitations

- **Scalar, monochromatic, continuous-wave field.** There is no polarisation (the interfaces leave room for Jones
  fields) and no pulse or temporal dispersion model; GVD is recorded but unused.
- **Thin-element approximation.** Element thickness is not propagated, except the explicit LCD–MLA gap. Surface
  reflections are counted as loss, not as ghost cavities.
- **Single optical path.** Routes have one path, so interference between distinct paths (for example two ring
  directions) is not modelled.
- **Grid and sampling constraints.** Grid sizes must be powers of two. Lens and microlens phase aliasing produces
  warnings rather than automatic refinement.
- **Simple gas and noise models.** Gas group index ≈ phase index. The gain noise model is additive Gaussian only.
