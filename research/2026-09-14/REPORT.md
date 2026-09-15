# PHASER capability research sprint — 2026-09-14

> Sections appear in the order experiments completed. **Start with the closing synthesis at the end ("Experiment 20"):**
> executive findings, capability envelope, surprises, architecture implications, next experiments, and the list of runs
> stopped unfinished. Raw data: `out/<experiment>/`. Scripts: this directory (disposable, one per experiment). Nothing here
> is a framework. Visual summary: `findings-canvas/phaser-capability-findings.html` (published design canvas).

## 0. Simulator, configurations, tooling and validity checks

### 0.1 Simulator facts that constrain every result

- Scalar, monochromatic CW field on a power-of-two grid; angular-spectrum free-space propagation (exact `k_z`, carrier removed);
  thin elements; absorbing cosine taper applied after every propagation segment.
- Nonlinearities available: per-sample **local saturable gain** `g = 1 + (G0−1)/(1+I/I_g)`, per-sample **saturable
  absorber** `a = 1 + s/(1+I/I_a)` (s<0), **Kerr** phase `φ = κ I`, **global** gain saturation on mean intensity, optional
  additive gain noise. Nothing has memory between trips (no carrier dynamics).
- Inputs: coherent field added at a coupler (pulse or continuous). Observation: any field/tap.
- Pixel dead zones are never resolved: with 2 samples per pixel, samples sit at ±¼ pitch, inside the active area for any
  fill factor ≥ 0.25; even 4 samples per pixel cannot see a 0.93 fill factor. Dead-zone diffraction is absent from all runs.
- Round-trip time is the actual `Σ n_g L / c` over the route.

### 0.2 Physical configurations actually used (research/2026-09-14/arch.ts)

| id | derived from preset | geometry | per-trip passive retention (localized, band-limited state) | round trip |
|---|---|---|---|---|
| **A_preset** | Reflective SLM ring, unchanged optics | 20+40+40+20+40+20+20 mm legs, relay lenses f = 40 mm (Ø1.2 mm) 100 mm apart, LCOS 64×64 px @ 20 µm (R = 0.75, 256 levels, γ = 1.05, λ_design 633 nm), preset random program (seed 3, depth 0.1), couplers 0.98/0.95, fold 0.995, air | 0.684 | 0.667 ns (1.499 GHz) |
| **A_img** | same ring, lenses f = 50 mm (2f spacing) + roof (flip-x at fold, flip-y extra mirror, R 0.995) | round-trip ABCD = +I (self-imaging), zero program | 0.684 | 0.667 ns |
| **A_img_rand** | A_img with the preset random SLM program | | 0.684 (uniform) | 0.667 ns |
| **A (defocus δ)** | A_img with the last leg lengthened by δ | ABCD = [[1, δ],[0, 1]] | | |
| **B_4f** | Transmissive LCD linear cavity (LCD, coupler 0.92, mirror 0.97 losses), plus two f = 100 mm lenses (Ø2 mm) | mirror/LCD at 0, L1 at f, L2 at 3f, end mirror at 4f; forward −I, round trip +I; LCD 63.5 µm, 1.8π stroke, air | 0.628 | 2.669 ns (0.375 GHz) |
| **B_flat** | shipped LCD linear cavity style: same length, no lenses | plane-parallel | 0.641 | 2.669 ns |
| **C_mla** | LCD + microlens stack parts | coupler 0.95 · 19.34 mm · [LCD, 1 mm glass, MLA f = 20 mm pitch 254 µm, σ_f = 2 %] · 20 mm · mirror 0.99; per-lenslet cat's eye; air 10 Pa | 0.411 | 0.273 ns (3.67 GHz) |

Grids: A 64² at 1 sample/pixel (dx = 20 µm, window 1.28 mm) for explicit operators and mask design; 128² at 2 samples/pixel
(dx = 10 µm) for direct dot runs. B, C: dx = 31.75 µm (2 samples/pixel).

Changes vs presets and why:
- A relay focal length 40 → 50 mm: the preset relay is a stable but non-degenerate resonator (Gouy ≈ 209°/trip); a dot
  launched off-axis is destroyed after one trip (validated, `out/01-validate.txt`). f = 50 mm makes the 100 mm lens spacing
  2f → round trip −I; the roof makes it +I so a dot returns to the same place each trip.
- B lenses f = 100 mm: with dx = 31.75 µm a thin-lens phase is alias-free only for r < λf/(2dx); f = 20 mm aliased
  (simulator warning), f = 100 mm is clean to r ≈ 1.02 mm.
- C d1 = f − 1 mm/1.52 so the reduced lens-to-lens distance is 2f both ways.

### 0.3 Tooling (all disposable scripts)

- `05-extract.ts`: explicit complex round-trip matrix M (4096×4096) by applying `CompiledSystem.roundTrip` to basis vectors.
- `04-coupling.py evolve`: M^t x by binary repeated squaring (only the current square held in memory).
- `twin-dump.ts` + `twin.py`: arrays pulled out of the live JS route (kernels, windows, lens transmissions, pixel maps) replayed in
  torch; the only re-expressed laws are the SLM/LCD phase response, saturable/Kerr and gain formulas. Used ONLY to design masks;
  every design is re-run in the JS simulator (`08-eval.ts`).

### 0.4 Validity checks

| check | result |
|---|---|
| numpy `M^t x0` vs direct JS evolution, A_img, t = 1…1e5 | relative error 8e-16 (t=1), 2e-13 (1e3), 1e-12 (1e4), **9.5e-12 (1e5)**; energy log identical (`out/04/validate_A_img.json`) |
| torch twin vs JS, 6 trips with random mask, Kerr, local gain, absorber, injection | A64 9e-15, A128 2e-14, B64 3e-15, C64 3e-15, defocused/−I variants ≤ 1.6e-13 (after adding 256-level quantisation) |
| compact route (segments merged across scalar elements) vs full preset leg route | **not equivalent** in general: the absorbing taper is applied once per segment, so fewer segments = less edge absorption (34 % field difference after 200 trips for a fine-featured field) |
| FFT wrap-around of mask-scattered light (`01c-wrap.ts`) | zero mask / moat / smooth fields: compact 64² ≈ 256² ≈ 10 mm steps (≤ 20 %). **Full π-checkerboard: compact 64² keeps ~0.25/trip vs ≤ 0.004/trip with a 5.12 mm window or 10 mm steps** — pixel-scale scattering walks > window per segment and wraps around the periodic FFT instead of being absorbed. All mask-design and nonlinear-memory runs therefore use ≤ 10 mm propagation steps. |


## Experiment 4 — empirical region-to-region coupling matrix (linear, gain-clamped)

**Hypothesis.** In a self-imaging cavity, coupling between cells is confined to the relay point-spread function (PSF) and stays
local for many trips; repeated recurrence slowly makes it dense.

**Configuration / method.** Explicit operators (64² grid) normalised by |λ1| (gain clamped at threshold). Regular Gaussian
cell lattices inside the flat part of the window: A_img 81 cells (σ 30 µm, pitch 100 µm = 5 px), B_4f 64 cells (σ 60 µm, pitch
190.5 µm = 3 px), C_mla 49 cells centred on lenslets (σ 80 µm, pitch 254 µm). One cell excited at a time; complex amplitude
coupling `T_t[j,k] = ⟨g_j| (M/|λ1|)^t |g_k⟩` for t = 1…128, 1024, 16384 (exact matrix powers). Script `04-coupling.py`,
data `out/04/coupling_*.json|npz`, figures `out/04/fig_coupling_maps_*.png`, `out/04/fig_coupling_stats_*.png`.

**Raw result** (mean over cells; `nn` = nearest-neighbour power coupling, includes Gaussian-basis overlap ≈ 0.03 for A/B;
`rank` = singular values > 1 % of the largest; `erank` = entropy effective rank).

| op | t | self | nn mean | nn max | far max | power-weighted interaction radius | rank / cells | erank |
|---|---|---|---|---|---|---|---|---|
| A_img | 1 | 0.844 | 0.036 | 0.086 | 9e-5 | 103 µm | 81/81 | 68.7 |
| A_img | 128 | 0.661 | 0.034 | 0.115 | 4.6e-4 | 106 µm | 77/81 | 60.7 |
| A_img | 1024 | 0.218 | 0.034 | 0.166 | 4.9e-4 | 115 µm | 73/81 | 56.6 |
| A_img | 16384 | 0.009 | 0.002 | 0.139 | **0.55** | 453 µm | 69/81 | 47.3 |
| B_4f | 1 | 0.889 | 0.045 | 0.086 | 6e-5 | 197 µm | 64/64 | 53.3 |
| B_4f | 128 | 0.616 | 0.036 | 0.082 | 1.4e-4 | 200 µm | 64/64 | 49.1 |
| B_4f | 1024 | 0.031 | 0.006 | 0.150 | 1.6e-3 | 280 µm | 46/64 | 27.6 |
| B_4f | 16384 | 0.044 | 0.005 | 0.123 | 2.1e-3 | 248 µm | 36/64 | 18.8 |
| C_mla | 1 | 0.399 | 0.017 | 0.030 | 1e-6 | 266 µm | 49/49 | 43.5 |
| C_mla | 16 | 0.170 | 0.010 | 0.027 | 1.4e-3 | 371 µm | 49/49 | 46.6 |
| C_mla | 128 | 0.008 | 0.003 | 0.020 | 0.018 | 777 µm | 49/49 | 37.3 |
| C_mla | 16384 | 0.0004 | 1.5e-4 | 0.005 | 1.9e-3 | 624 µm | 3/49 | 1.3 |

**Interpretation.**
- In A and B the coupling is **nearest-neighbour only and essentially static for ≥128 trips**: the power-weighted interaction
  radius stays at one lattice pitch (A 103→106 µm, B 197→200 µm), long-range coupling ≤ 5e-4, and the transfer map keeps
  near-full rank (A 77/81, B 64/64). Coupling is isotropic (impulse maps are 4-fold symmetric) and its phase is a smooth
  radial pattern (`fig_coupling_maps_A_img.png`), i.e. set by the relay PSF, not by the mask (zero mask here).
- The self term decays slowly (A: 0.84 → 0.66 over 128 trips relative to the dominant mode) — cells are not eigenmodes; their
  light drains into the long-lived Laguerre–Gauss subspace (Exp. 5). By 10³–10⁴ trips the map becomes non-local (A far max
  0.55 at t = 16384: a cell's light ends up in a distant cell) and rank falls (A 47 erank, B 19).
- C (cheap LCD+MLA) has no locality beyond a few trips: per-lenslet cells lose 60 % in one trip, the interaction radius
  triples by t = 128, and after 10⁴ trips only ~1–3 independent directions remain.
- Boundary effect: the minimum self-retention (`self_min`) at t=128 is 7e-4 (A) — corner cells of the lattice are vignetted
  by the relay lens apertures; usable field of view is ≈ ±400 µm in A, ≈ ±700 µm in B.

**Confidence.** High (exact linear algebra, validated operator). Caveat: coupling depends on the chosen cell basis; the
nn numbers include basis overlap — the *time dependence* is the physical signal.

## Experiment 5 — long-lived modal spectrum

**Hypothesis.** A self-imaging cavity has a large, nearly degenerate long-lived subspace whose size is set by the relay étendue,
not by pixel count; mask disorder and non-imaging geometries collapse it to a few modes.

**Method.** Full eigendecomposition of the explicit 4096×4096 operators (`05-spectrum.py`, numpy LAPACK, ≈80 s each).
τ_abs = −1/ln|λ| (passive); τ_rel = −1/ln(|λ_k|/|λ_1|) (gain clamped on the dominant mode — the physically relevant memory
time in a saturated cavity). Participation ratio (PR) and rms size of each eigenvector. Validation: M^t x0 vs direct JS
evolution to 1e5 trips (rel. error 9.5e-12). Figures `out/05/fig_eigen_lifetime_spectrum.png`, `out/05/fig_modes_*.png`.

**Raw result.**

| operator | abs λ1 (amplitude) | t_rt | modes τ_rel >10 | >100 | >1e3 | >1e4 | >1e5 | leading-mode character |
|---|---|---|---|---|---|---|---|---|
| A_img | 0.827 | 0.667 ns | 306 | 200 | 173 | 147 | **85** | centred Laguerre–Gauss family (PR 84–350 samples, rms 52–110 µm), degenerate to 1e-11 in abs λ, args differ by ≈5e-4 rad per mode order |
| A_img_rand (preset random SLM mask on A_img) | 0.820 | 0.667 ns | 308 | 143 | 4 | 2 | 1 | localised speckle-like modes (PR 9–57) scattered over the aperture |
| A_preset (f = 40 mm relay, random mask) | 0.820 | 0.667 ns | 162 | 111 | 20 | 2 | 1 | broad centred modes (PR 150–265), args spread over 2π (non-degenerate Gouy) |
| A_preset, 10 mm steps (wrap-free) | | | 162 | 111 | 19 | 2 | 1 | identical ⇒ spectrum not affected by the FFT wrap artefact |
| B_4f | 0.792 | 2.669 ns | 851 | 344 | 310 | 212 | **155** | centred modes (PR 64–130), args within 3e-3 rad |
| B_flat (lensless) | 0.787 | 2.669 ns | 294 | 29 | 1 | 1 | 1 | global plane-wave-like modes (PR 850–1400) |
| C_mla | 0.773 | 0.273 ns | 66 | 29 | 5 | 1 | 1 | a few lenslet-array supermodes (rms ≈ 400 µm) |

No mode is long-lived without gain: τ_abs < 10 trips for every mode of every operator (|λ| ≤ 0.83 ⇒ 31 % power loss per trip);
all long lifetimes quoted are relative to a gain-clamped dominant mode.

**Answers.**
- *How many modes live >10 / >100 / >1e3 / >1e5 cycles?* A_img: 306 / 200 / 173 / 85; B_4f: 851 / 344 / 310 / 155; every
  other tested configuration: ≤ 20 above 1e3 and 1 above 1e5.
- *Localized or global?* In the good configurations the long-lived modes are **global, centred Laguerre–Gauss-like** modes of
  the relay; a localized dot is a superposition of many of them. Localized eigenmodes appear only with mask disorder
  (A_img_rand) — and then they are short-lived (τ ≈ 10²–10³).
- *Can multiple long-lived quasi-orthogonal modes coexist in one region?* Yes: in A_img the 85 modes with τ > 1e5 all overlap
  the same ≈0.3 mm² central region; mean |overlap| between the leading 200 eigenvectors is 0.003 (max 0.93 for near-degenerate
  pairs). That is ~85 concurrently persistent latent components in 0.3 mm² — but they are modes, not pixels.
- *Why so few?* The count matches the relay étendue estimate (FOV ≈ 0.3 mm radius × NA ≈ 5 mrad → ~50–100 modes) and not the
  4096 SLM pixels: the 1.2 mm lens apertures 40–60 mm from the SLM plane are the bottleneck.
- *Predicted vs direct lifetimes.* Energy decay of direct JS runs matches −2 ln|λ1| per trip to 13 digits; shape lifetimes in
  Exp. 1 are **not** set by |λ| (the subspace is degenerate) but by the arg(λ) spread (dephasing, with revivals) — see Exp. 1.

**Confidence.** High for the model; medium for physical relevance (thin paraxial lenses + exact angular spectrum: the only
aberration is the non-paraxial propagation phase; real relays will have more).

## Experiment 6 — operating regimes / edge of stability

**Hypothesis.** Local saturable gain + saturable absorber gives a bistable per-sample map; between "everything dies" and
"everything lases" there is a band where written patterns persist (long-memory), and a near-critical band where perturbations
matter but trajectories neither collapse nor explode.

**Configuration.** A_img (self-imaging ring, 64² grid, 1 sample/pixel, compact route), local gain I_g = 1, absorber I_a = 0.05,
Kerr κ = 0. Swept G0 ∈ {1.6 … 4.0} × s ∈ {−0.2, −0.4, −0.6, −0.8}; three static programs: zero mask (uniform medium, 12×12
cells 2 px on 4 px pitch), "moat" (π-checkerboard outside 3 px cells, 5 px pitch) and moat (4 px cells, 6 px pitch).
3000 trips per point. (The κ = 1 pass was stopped to free CPU; not reported.)

**Method** (`06-regime.ts`, `06-plot.py`). Random 50 % bit pattern written at t = 0 (I = 1.5 per cell) + 1e-3 noise.
Largest Lyapunov exponent by Benettin renormalisation of a twin trajectory (ε = 1e-7, every 10 trips, averaged over the second
half); pattern memory = correlation of cell intensities at T with t = 0; BER against the written bits; fill fraction
(samples with I > 0.3); input sensitivity = cell-intensity change caused by a weak pulse (I = 0.05) into one OFF cell at T/2.
Analytic per-sample map r(I) = 0.684·g(I)·a(I) with no diffraction: monostable-off / off-unstable / bistable.

**Raw result** (`out/06/regime_classified.csv`, `out/06/fig_regime_map.png`). Class counts over 132 points:

| empirical class | count | analytic per-sample prediction |
|---|---|---|
| extinct (trivial attractor) | 24 | 15 monostable-off, 9 bistable |
| near-critical (λ_L within ±1e-3, pattern not held) | 55 | 37 bistable, 18 off-unstable |
| chaotic/expanding (λ_L > 1e-3) | 18 | 8 bistable, 10 off-unstable |
| saturated / lasing everywhere (fill > 35 %) | 35 | 21 bistable, 14 off-unstable |
| **long-memory stable (BER ≤ 2 %, pattern corr > 0.9)** | **0** | — |
| strong contraction (non-trivial) | 0 | — |

- Zero mask: G0 = 1.6 extinct for every s; G0 ≥ 1.8 with any absorber that does not kill the state → fronts invade and the
  window saturates (fill 40–80 %, energy ×4–40, pattern corr ≈ 0, BER ≈ fraction of zeros); λ_L ≈ +1e-4…+4e-3.
- Moat masks: a wide yellow band (G0 1.8–2.6) of dim, disordered states (energy 0.02–1.3× initial, fill 1–14 %, pattern corr
  0.1–0.3, λ_L within ±1e-4, input response 1e-7…1e-3) and a chaotic corner at G0 ≥ 3 (λ_L +1e-3…+5e-3, input response up to
  ~3, i.e. a tiny pulse rearranges the whole state).
- The analytic per-sample map predicts bistability in 66 of the 132 points; **none of them holds a pattern**. The per-sample
  map ignores diffraction: the relay PSF (FWHM ≈ 28 µm ≈ 1.4 px) spills a few % of an ON cell into its neighbours every trip,
  while the switching threshold sits at ≈ 5 % of the ON level (I_a/I_on). Neighbour spill > threshold ⇒ ON spreads (zero
  mask) or moat losses (≈ 60 % per trip for a 3 px cell, `01c-wrap.ts`) kill cells ⇒ disordered remnants.

**Interpretation.** In this simulator the "edge of stability" is not a memory regime by itself: bistability of the local
medium is necessary but not sufficient. Persistent digital state needs (threshold / ON level) > (neighbour PSF spill / ON
level), which the tested absorber saturation cannot deliver at 1–2 px cell gaps. Candidate operating points by use:
- **reservoir computation:** below-threshold local gain (G0 ≤ 1.6 with s = −0.2, λ_L ≈ −0.07/trip, i.e. fading memory of
  ~15 trips) or the linear gain-clamped regime (λ_L = 0, memory set by the eigen-spectrum; Exp. 15 confirms this is where
  reservoir memory is best);
- **persistent recurrent policy computation:** near-critical moat band (G0 ≈ 2.0–2.4, s = −0.6…−0.8): λ_L ≈ 0, inputs
  change the state without runaway — but the state it carries is disordered, not a designed code;
- **attractor / digital storage:** not found by parameter sweeps with hand-built masks; requires designed masks (Exp. 2nl, 8, 16).

**Confidence.** Medium-high for the classification at the tested grid (single seed per point, 3000 trips). The compact route
was used; the wrap artefact is negligible for moat masks (checked) but the κ = 1 pass and finer G0 steps near pinning were not run.

## Experiment 1 — single-dot echo stability

**Hypothesis.** A self-imaging static program preserves a localized dot down to about the relay's diffraction-limited spot;
smaller dots are destroyed immediately; larger ones survive for a long but finite horizon; gain stabilizes energy, not shape.

**Configurations** (§0.2). A_preset (passive/default optics + preset random SLM program); A_img (best static configuration:
self-imaging relay, zero program); robustness variants A_img + preset random mask, + 0.1 % / 1 % focal error of one relay lens,
full (non-compacted) route, 4 samples/pixel; gain/nonlinear: global gain clamp (mathematically identical to the renormalized
linear runs) and local gain G0 = 2.2 + saturable absorber s = −0.6, I_a = 0.05 ("bistable"); B_4f; C_mla (dot on a lenslet).

**Method** (`01-dot.ts`, `01-plot.py`, long horizon `04-coupling.py dots`). Gaussian intensity-rms σ launched at (60, 40) µm
(C: on a lenslet centre). Linear runs renormalised every trip (energy tracked as Σ ln P_t/P_{t−1}). Log-spaced checkpoints
(8/decade). Metrics: intensity correlation with the launched dot, complex fidelity, phase coherence, rms width (global and
within max(3σ, 2 px)), FWHM, centroid drift, energy, peak, leakage outside max(3σ, 2 px), per-trip gain, correlation with the
previous checkpoint. Direct runs: 128² (A), 10⁵ trips for σ ≥ 20 µm, 10⁴ otherwise; A_img to 10⁶ trips by exact matrix
powers on the 64² grid. Mask optimisation `01b-maskopt.ts`: 1-parameter scan (+ bisection) of a static SLM lens.

**Validation.** 64²/1-sample-per-pixel matrix extrapolation vs direct 128²/2-samples-per-pixel at 10⁵ trips: σ = 20 µm corr
0.196 vs 0.195, width × 4.14 vs 4.16; σ = 40 µm 0.4156 vs 0.4156; σ = 57 µm 0.4617 vs 0.4617. Full route vs compact route
(σ = 20 µm): identical lifetimes (422 / 1334 trips). 4 samples/pixel: σ = 3, 5 µm die at t = 1–2 exactly as at 2 samples/pixel.

**Raw result — lifetime (round trips) to the first violation** (`out/01/lifetime_summary.csv`; "+" = survived the whole run).

| config | σ (µm / px / samples) | corr < 0.9 | corr < 0.5 | width ×1.5 | leakage > 0.2 | physical time at corr < 0.9 |
|---|---|---|---|---|---|---|
| A_preset | every σ 3–80 µm | 1 | 1 | 1–562 | 1–18 | 0.67 ns |
| A_img | 3 / 0.15 / 0.3 | 1 | 2 | 1 | 1 | 0.67 ns |
| A_img | 10 / 0.5 / 1 | 2 | 562 | 1 | 178 | 1.3 ns |
| A_img | 14 / 0.7 / 1.4 | 316 | 562 | 1 | 237 | 0.21 µs |
| A_img | 20 / 1 / 2 | 422 | 1334 | 316 | 422 | 0.28 µs |
| A_img | 28 / 1.4 / 2.8 | 750 | 3162 | 750 | 750 | 0.50 µs |
| A_img | 40 / 2 / 4 | 1778 | 4217 | 1778 | 2371 | 1.19 µs |
| A_img | 57 / 2.85 / 5.7 | 2371 | 4217 | >1e5 | 5623 | 1.58 µs |
| A_img + random SLM program | 20 / 1 | 24 | 100 | 4 | 24 | 16 ns |
| A_img + random SLM program | 40 / 2 | 18 | 178 | 18 | 56 | 12 ns |
| A_img, 0.1 % lens error | 40 / 2 | 422 | 1000 | 1000 | 1000 | 0.28 µs |
| A_img, 1 % lens error | 40 / 2 | 42 | 133 | 133 | 133 | 28 ns |
| local gain + absorber (bistable) | 20 / 1 | 24 | 56 | 24 | 42 | 16 ns |
| B_4f | 32 / 0.5 | 237 | 750 | 237 | 422 | 0.63 µs |
| B_4f | 64 / 1 | 1334 | 2371 | >1e4 | 2371 | 3.56 µs |
| B_4f | 128 / 2 | 1000 | >1e4 | >1e4 | >1e4 | 2.67 µs |
| C_mla | 32–128 / 0.5–2 | 1–24 | 3–42 | 1–2 | 1–10 | ≤ 6.6 ns |

**A_img long horizon (exact matrix powers, 64²):**

| σ (µm) | corr @1e2 | @1e3 | @1e4 | @1e5 | @1e6 | width ratio @1e6 | leakage @1e6 |
|---|---|---|---|---|---|---|---|
| 20 | 0.997 | 0.519 | 0.384 | 0.196 | 0.638 | 3.17 | 0.61 |
| 28 | 1.000 | 0.793 | 0.637 | 0.315 | 0.735 | 2.12 | 0.53 |
| 40 | 1.000 | 0.967 | 0.848 | 0.416 | 0.723 | 1.53 | 0.38 |
| 57 | 1.000 | 0.998 | 0.870 | 0.462 | 0.679 | 1.21 | 0.16 |
| 80 | 1.000 | 0.999 | 0.804 | 0.532 | 0.722 | 1.05 | 0.06 |

**Revivals** (`out/01/fig_corr_vs_cycles.png`): the correlation of every A_img dot *recovers* to 0.99 near 2.3×10⁴ trips and
again near 6×10⁴ (direct 128² run); B_4f recovers to 1.00 near 5.6×10³ trips; C_mla to 1.00 at 13 trips (then dies by 50);
A_preset shows re-entrant revivals at ~7 and ~25 trips (a dot destroyed after one trip comes back to corr 0.9). Correlation at
10⁶ (0.64–0.73) is higher than at 10⁵ (0.20–0.53) for the same reason.

**Static-mask optimisation** (`out/01/maskopt_H100.csv`).
- A_img with a 1 % focal error on one relay lens: the best static SLM lens (0.78 D) raises corr@100 from 0.39 to 0.68
  (partial compensation — the SLM is not conjugate to the lens with the error).
- A_preset hardware (f = 40 mm): the scan "finds" an SLM lens of 3.04 D with corr@100 = 0.997 (zero program: 0.958 at t=100,
  best 0.99 at t = 50). This is not a self-imaging solution: it tunes the Gouy phase so the resonator becomes re-entrant with
  a period dividing 100. **A single-horizon objective is gameable by recurrence;** the dot is destroyed in between.

**Answers.**
- *Minimum stable dot width:* none. No localized dot is a fixed point or eigenmode in any tested configuration; the
  long-lived eigenmodes are global (Exp. 5). "Stable" was never reached, even at 10⁶ trips in the ideal self-imaging ring.
- *Minimum metastable width (corr ≥ 0.9) by horizon in A_img:* 10 trips → σ ≥ 14 µm (0.7 px, FWHM 33 µm);
  100 trips → σ ≥ 14 µm; 1000 trips → σ ≥ 40 µm (2 px, FWHM 94 µm); 10 000 trips → none (best 0.87 at σ = 57 µm);
  100 000 trips → none (best 0.53). B_4f: 1000 trips → σ = 64 µm (1 LCD px); 10⁴ → none by corr ≥ 0.9.
- *Is there a true localized fixed/eigenstate?* No. Large dots (σ = 80 µm) converge toward the centred Laguerre–Gauss family
  (width ratio 0.58 at 10⁴, drift toward the axis), small ones spread into it.
- *Does gain stabilize shape or only energy?* Global gain: energy only (shape evolution identical to the linear run by
  construction). Local gain + saturable absorber in a uniform medium: destroys the dot in 24–56 trips — the ON state invades.
- *What destroys an undersized dot?* In order of horizon: (1) the relay NA (Ø1.2 mm lenses 40–60 mm from the SLM,
  PSF FWHM ≈ 28 µm) removes sub-pixel content on the first trip (σ ≤ 10 µm: corr < 0.9 at t ≤ 2); (2) dephasing of its
  Laguerre–Gauss components (arg λ spread ≈ 5e-4 rad per mode order, from the non-paraxial propagation phase) over
  10³–10⁴ trips — reversible, hence the revivals; (3) static phase disorder on the SLM (preset random program, ≤ 0.2π) —
  18–24 trips; (4) relay focus errors: 0.1 % → ÷4, 1 % → ÷40 in lifetime.

**Interpretation.** A self-imaging cavity is an excellent *linear, coherent, finite-horizon* store for 2–3 px features
(~1 µs in A, ~3.6 µs in B), with information that is dephased rather than lost; it does not create a localized attractor.
The quantities that set dot lifetime are optical (NA, aberration phase spread, focus error, mask disorder), not pixel count.

**Failure modes / caveats.** Thin paraxial lenses (the real aberration budget will be worse); no noise in these runs;
dead zones unresolved. σ = 80 µm direct 128² run at 10⁵ trips: corr 0.5321, width × 0.869, leakage 0.120 — matrix extrapolation gave 0.5322 / 0.869 / 0.121.

**Confidence.** High for A_img/B_4f numbers (two grids and two methods agree); the shape metric thresholds are conventions.

## Experiment 15 — reservoir computing baseline

**Hypothesis.** The messy recurrent cavity with fixed masks carries useful temporal information; memory horizon tracks the
eigen-lifetime spectrum and nonlinear tasks need an intensity nonlinearity (detection or medium).

**Configuration** (`15-reservoir.ts`, `15-readout.py`, `out/15/`). 64² grids, fixed preset random program (seed 3, depth 0.1)
on every device. Operating points: `Apre_lin` A_preset + global gain clamp; `Apre_sat` A_preset + local gain G0 1.6 + absorber
s −0.2 (below lasing); `Apre_sat2` G0 2.0, s −0.4 (near/above threshold); `Apre_kerr` Apre_sat + Kerr κ = 1; `Aimg_lin`,
`Aimg_sat` self-imaging ring with the same program; `B_sat` B_4f G0 1.8; `C_sat` C_mla G0 2.2. Input: scalar u(t) injected every
K round trips through a static smooth random complex spatial pattern (40 Gaussians), K ∈ {1, 10}; 3200 input steps
(uniform u ∈ [0, 0.5] and binary streams, separate runs). Features: log10 of 16×16-binned |E|² (256) sampled once per step.
Digital ridge readout (evaluation only): train steps 200–2200 (λ chosen on the last 20 %), test 2200–3200.
Baselines: 8-tap linear delay line; ESN-256 (tanh, spectral radius 0.9, random bias).

**Raw result.**

| operating point | K | memory capacity Σr² (k ≤ 60) | max delay r² > 0.5 | NARMA10 NMSE | XOR d=0 / d=2 | parity3 d=0 | feature rank (99 % var) |
|---|---|---|---|---|---|---|---|
| Apre_lin | 1 | 30.4 | 31 | 0.208 | 1.000 / 0.917 | 0.763 | 158 |
| Apre_lin | 10 | **34.6** | **37** | **0.193** | 0.999 / 0.983 | 0.838 | 183 |
| Apre_sat | 1 | 31.2 | 31 | 0.199 | 1.000 / 0.914 | 0.740 | 136 |
| Apre_sat | 10 | 10.8 | 11 | 0.271 | 1.000 / 1.000 | **1.000** | 11 |
| Apre_sat2 (near lasing) | 1 | 3.4 | 0 | 0.837 | 0.784 / 0.545 | 0.502 | 230 |
| Apre_sat2 (near lasing) | 10 | 0.4 | 0 | 0.991 | 0.546 / 0.511 | 0.516 | 231 |
| Apre_kerr | 1 | 14.1 | 12 | 0.469 | 0.959 / 0.776 | 0.620 | 205 |
| Apre_kerr | 10 | 5.2 | 5 | 0.597 | 1.000 / 1.000 | 1.000 | 51 |
| Aimg_lin (self-imaging) | 1 | 2.0 | 0 | 1.473 | 0.892 / 0.739 | 0.563 | 131 |
| Aimg_lin | 10 | 4.7 | 0 | 1.343 | 0.937 / 0.923 | 0.740 | 213 |
| Aimg_sat | 10 | 4.9 | 4 | 0.764 | 1.000 / 1.000 | 1.000 | 6 |
| B_sat | 1 | 17.6 | 1 | 0.301 | 0.882 / 0.701 | 0.685 | 86 |
| B_sat | 10 | 15.9 | 16 | 0.372 | 1.000 / 0.994 | 1.000 | 53 |
| C_sat | 1 | 5.4 | 2 | 0.949 | 0.832 / 0.708 | 0.540 | 176 |
| C_sat | 10 | 2.8 | 1 | 0.866 | 0.807 / 0.597 | 0.545 | 129 |
| 8-tap linear delay line (digital) | — | 7.0 | — | 0.640 | 0.508 | — | 8 |
| ESN-256 tanh + bias (digital) | — | 7.1 | — | 0.663 | 1.000 | — | 256 |

Physical step time: A 0.67 ns (K = 1) / 6.7 ns (K = 10); B 2.67 / 26.7 ns; C 0.27 / 2.7 ns.

**Interpretation.**
- The **non-degenerate "messy" relay in its linear (gain-clamped) regime is the best reservoir**: memory capacity 30–35 with
  r² > 0.5 out to 31–37 input steps and NARMA10 NMSE 0.19–0.21, beating a 256-unit tanh ESN (MC 7, NMSE 0.66). Square-law
  detection supplies the product terms, so delayed XOR is solved without any medium nonlinearity.
- **Self-imaging hurts reservoir memory** (MC 2–5) even though it maximises state lifetime (Exp. 5: 85 modes > 1e5 trips).
  With M ≈ identity every past input lands on the same pixels with the same phase, so a readout cannot separate delays.
  Long *storage* needs degenerate eigenvalues; long *temporal memory capacity* needs distinct eigen-phases — the two
  requirements conflict. The preset relay's spread of Gouy phases (Exp. 5: args spread over 2π) is what makes it work.
- **Medium nonlinearity trades memory for nonlinear expressivity**: Apre_sat at K = 10 solves parity-3 perfectly but keeps only
  MC ≈ 11; Kerr likewise. Near/above lasing (Apre_sat2) the state is dominated by the saturated mode and memory vanishes
  (MC 0.4) — the edge-of-stability regime is not the useful one here.
- Architecture: B (linear LCD 4f) is a decent reservoir (MC 16–18, parity 1.0 at K = 10); cheap C is weak (MC ≤ 5).
- Memory vs eigen-spectrum: A_preset has 111 modes with τ_rel > 100 trips and 20 > 1000 (Exp. 5); at K = 10 the measured
  horizon 37 steps = 370 trips sits between those, consistent with the memory living in the τ ≈ 10²–10³ modes. Increasing K
  from 1 to 10 barely changed Apre_lin (the relevant modes live ≫ 10 trips).

**Confidence.** Medium-high (single seed per configuration, 1000-step test set). Readout is digital by design.

## Experiments 2 & 3 — packing density, encodings, and the transient density × lifetime frontier (linear / gain-clamped)

**Hypotheses.** (2) Independent persistent states can be packed at roughly the PSF spacing; differential encodings are more
robust than presence. (3) Transient states pack much more densely than persistent ones; lifetime grows with spacing.

**Configuration / method** (`02-linear-packing.py`, `02-plot.py`, `out/02/`). Exact matrix powers of the gain-clamped
operators (horizons t = 2^k to 2^20 ≈ 1.05e6 trips). Square cell lattices, pitch 1–16 samples, Gaussian cells σ = 0.25 or
0.4 × pitch; 24 random bit patterns per lattice; relative-phase variants (all 0, checkerboard 0/π, random). Encodings:
presence, phase 0/π (decoded against the evolved all-zero reference, i.e. a per-cell phase reference), dual-rail (one of two
adjacent cells lit), differential intensity (both lit, 75/25 split). Decoders (all fixed per lattice and horizon, no per-pattern
adaptation): Gaussian projection + global threshold; 0.8·pitch square detector + global threshold (`_sq`); square detector +
per-cell calibrated threshold (`_sqcal`); pairwise comparison for dual-rail/differential. A lattice "lifetime" = largest
power-of-two horizon with BER ≤ target at every earlier recorded horizon. Field of view (FOV) ±400 µm first, then ±200 µm.

**Key methodological finding — vignetting dominates unless excluded.** Per-cell self-retention after ONE trip across the ±400 µm
A_img lattice (`out/04/coupling_A_img.npz`): 1.00 inside ±200 µm, 0.85–0.87 at 400 µm on-axis, **0.09 in the corners**; after
128 trips corners 7e-4, centre 0.99. The relay lens apertures (Ø1.2 mm, 40–60 mm from the SLM) vignette the field. With a
±400 µm FOV every presence decoder had 2–30 % BER from t = 1 at all pitches; the "flat" FOV is only ≈ ±200 µm (0.16 mm², 20×20
SLM pixels of 64×64).

**Raw result — A_img, flat FOV ±200 µm, BER = 0 (24 patterns), lifetime in round trips (logical states in the FOV).**

| pitch | logical states/mm² (1 bit/cell) | presence (Gaussian) | presence (square, per-cell thr.) | phase 0/π | dual-rail (square) | differential |
|---|---|---|---|---|---|---|
| 20 µm (1 px) | 2500 | 0 (400) | 0 | 0 | 0 | 0 |
| 40 µm (2 px) | 625 | 0 (100) | 0 | 0 | 0 (BER≤1%: 2) | 0 |
| **60 µm (3 px)** | **278** | 2 (44) | **128** | **128** | **128** (22 bits) | 128 |
| 80 µm (4 px) | 156 | 128 (25) | 256 | 256 | 256 | 256 |
| 100 µm (5 px) | 100 | 256 (16) | 256 (BER≤1%: 512) | 512 | 512 | 512 |
| 120 µm (6 px) | 69 | 512 (11) | 512 | 512 | 512 | 512 |
| 160 µm (8 px) | 39 | 512 (6) | 1024 | 1024 | 1024 | 1024 |
| 200 µm (10 px) | 25 | 512 (4) | 1024 | 1024 | 1024 | 1024 |
| any | — | fails by 2048–4096 trips | ← | ← | ← | ← |

Physical time: 128 trips = 85 ns, 1024 trips = 0.68 µs (t_rt = 0.667 ns).

Other operators (±400 µm A, ±700 µm B/C FOV, so vignetting-limited; best zero-error lifetimes): B_4f phase 0/π 1024 trips at
508 µm pitch (3.9 bits/mm²), 512 trips at 317 µm (10/mm²), dual-rail (square) 256 trips at 317 µm; C_mla ≤ 32 trips at any pitch;
A_img with the preset random SLM program ≤ 128 trips at 320 µm pitch (÷8 vs zero program).

**Cross-talk vs pitch** (`fig_xtalk_vs_pitch_*.png`): nearest-neighbour power cross-talk of an isolated excited cell in A_img
is set by basis overlap + PSF (≈ 3 % at 100 µm pitch, σ = 30 µm) and is essentially constant for ~10² trips, rising after
10³ trips as the light dephases into the global modes.

**Interpretation.**
1. **No permanent state exists in the linear regime.** Every encoding at every pitch fails by 2–4 × 10³ trips (1.4–2.7 µs) —
   the same dephasing ceiling seen for single dots (Exp. 1). "Persistent" density is therefore **zero** for linear
   storage; all numbers above are finite-horizon retention.
2. **Transient frontier is a clean scaling law** in the flat FOV: lifetime ≈ 128 · (pitch / 60 µm)^≈2 up to the ≈ 2×10³-trip
   dephasing ceiling (60→128, 80→256, 100→512, 160→1024). Since density ∝ pitch⁻², **density × lifetime ≈ 3.5–5 × 10⁴
   bit·trips/mm²** is roughly conserved (60 µm: 278 × 128 = 3.6e4; 80: 4.0e4; 100: 5.1e4; 160: 4.0e4). Below 3 px pitch
   there is a sharp wall: the relay NA (PSF FWHM ≈ 28 µm) makes 40 µm pitch fail immediately.
3. **Encodings:** once vignetting is excluded, all encodings with a sensible decoder perform identically (phase, dual-rail,
   differential, presence with a detector-square decoder). Presence with a Gaussian-projection decoder is the only loser at
   small pitch (60 µm: 2 trips vs 128). With vignetting present, per-cell references (dual-rail, phase, per-cell thresholds)
   are what rescue decoding. Dual-rail costs 2× area for no lifetime gain here.
4. **Capacity across the aperture:** the usable flat FOV of the SLM ring holds only **44 states at 60 µm pitch for ~0.1 µs**,
   or 6 states for ~0.7 µs. The optical relay, not the 4096-pixel SLM, sets the budget.
5. Capacity vs error threshold (`fig_capacity_vs_threshold.png`): relaxing BER from 0 to 1 % changes lifetimes by at most one
   power of two — the failure is abrupt (dephasing), not a slow error-rate creep.

**Confidence.** High (exact linear algebra, validated operator; 24 patterns per point so BER resolution ≈ 1/(24·cells)).
Caveat: noiseless, thin ideal lenses; the nonlinear (bistable) packing is reported separately below.

## Experiments 13 & 14 — native reference and circuit bookkeeping (optical execution results are reported with Exps. 8–12)

**Native C / LLVM (`c/kernels.c`, `c/kernels_O{0,1,2}.ll`, `out/13/ref_*.csv`).** The three kernels were compiled with
Apple clang 17 and executed exhaustively: `step` over all 65 536 (int8 error, uint8 acc) pairs, `parity` over all 256 bytes,
`gcd8` over all 65 536 pairs. The modulo and repeated-subtraction gcd agree on every pair; worst-case loop iterations are
**12 (modulo) vs 255 (subtraction)**. `-O2` IR:
- `step`: `icmp sgt`, `icmp ne`, `and`, `add nuw`, `icmp slt`, `icmp ne`, `and`, `sext`, `add`, one branch/φ — branch-light;
- `parity`: three `lshr`/`xor` pairs and an `and` — pure bitwise;
- `gcd8`: a loop around `urem` — the only kernel needing iteration/state.

**Gate-level lowering (`14-circuits.py`, `out/14/circuits.json`)** — two-input AND/OR/XOR + NOT, each netlist simulated and
checked against the native tables:

| netlist | gates | depth | inputs → outputs | check |
|---|---|---|---|---|
| parity8 (literal lowering of the shifts/xors) | 11 XOR | 3 | 8 → 1 | 256/256 |
| saturating step, 8-bit (zero/sign tests, all-ones/any-ones, ±1 ripple adder) | 66 | 24 | 16 → 8 | 65 536/65 536 |
| one iteration of subtraction gcd8 (two subtractors, equality, mux, b==0) | 202 | 31 | 16 → 17 | 6304/6304 (all pairs < 48 + 4000 random); ≤ 248 iterations, mean 16.3 |
| accumulator machine step (LDI/LOAD/STORE/ADD/XOR/DEC/JNZ/HALT, 4-bit data, 4-bit PC, 4 RAM cells) | 316 + ≈224 ROM | 20 | 31 → 24 | structural estimate |

Machine state for the accumulator: 25 bits (ACC 4, PC 4, RAM 16, halt 1) + 16×7-bit program ROM. Program lengths:
`ldi 3; store x; ldi 4; add x; halt` = 5 instructions; parity8 on this ISA (no shift) ≈ 17 instructions over 9 RAM cells;
saturating step ≤ 9; gcd8 needs an 8-bit datapath and ≈ 8 instructions per subtraction step × ≤ 255 iterations.

These counts turn a measured per-gate optical cost into area/recurrence estimates for Exp. 14 (direct spatial compilation =
one static field implementing the netlist; sequential machine = the 316-gate step + ROM + 25 persistent bits, clocked).

## Experiment 10 — autonomous clock / state progression

**Hypothesis.** A static optical program can supply its own clock: a re-entrant resonator (round-trip ABCD matrix M with
M^q = I) carries any launched state through q distinct field states with no electronic update; a static SLM lens can tune q.

**Configurations** (`10-clock.ts`, `10-plot.py`, `out/10/`).
- q = 2 toggle: A_img optics **without** the roof (round trip −I): a dot alternates between x and −x every trip.
- q/p = 5/2, 7/3, 12/5: A_preset optics (f = 40 mm relay, stable, trace −1.75 ≈ 151°/trip) plus **one static SLM lens** whose
  power is solved in closed form from trace(M) = 2cos(2πp/q) (M = A·[[1,0],[−P,1]] ⇒ tr M = tr A − P·A₀₁): +6.60 D, −2.60 D,
  +0.90 D, rendered through the device's wrap/γ/633 nm-design response; 10 mm propagation steps.
- q = 4 and q = 8 were **infeasible** on this hardware: they need 87.5 D and 158 D (f ≈ 11 mm and 6 mm) — beyond the ≈ 25 D
  alias limit of a 20 µm-pixel SLM across the 1.28 mm window.
- Linear gain clamp (renormalised each trip); additive complex noise 0, 1e-4, 1e-3 of the state power per trip; one run with
  local gain G0 = 1.6 + absorber instead of the clamp. A 2 px (σ = 40 µm) dot launched at (160, 100) µm.

**Method.** Reference fields = the states at trips q…2q−1. At every decoded trip the state is the reference with the largest
normalised overlap |⟨ref|E⟩|²; the expected index is t mod q. One-hot contrast = best / second-best overlap. First sequence
error = first decoded trip whose index is wrong. Decoding every trip for the first 64 cycles, then q consecutive trips at
log-spaced times to 1e5 (q = 2) or 2e4 (others).

**Raw result.**

| clock | static program | ticks/cycle | trips/tick | first sequence error (trips) | decoded correctly | contrast early → late | physical time to first error |
|---|---|---|---|---|---|---|---|
| q = 2 toggle (−I ring) | none | 2 | 1 | 3162 (same with noise 1e-4, 1e-3) | 94 % | ~1e10 → 7 (2 at 1e-3 noise) | 2.1 µs |
| q = 5 | SLM lens +6.60 D | 5 | 1 (advances 2 states) | 1778 (noise 0); 3162 (noise 1e-4, 1e-3) | 94–96 % | ~2e3 → 1.02 | 1.2–2.1 µs |
| q = 7 | SLM lens −2.60 D | 7 | 1 (advances 3) | 1000 | 91 % | ~10 → 1.0 | 0.67 µs |
| q = 12 | SLM lens +0.90 D | 12 | 1 (advances 5) | ≈ 500 | 59 % | ~2 → 1.0 | 0.33 µs |
| q = 2, local gain + absorber (no clamp) | none | 2 | 1 | 3162 | 96 % | overlap decays within ≈ 130 trips | — |

Clock frequency = round-trip frequency = 1.50 GHz (one state advance per trip).

**Interpretation.**
- **Yes: static optics alone produce an autonomous, electronically unclocked state progression.** Every re-entrant program
  cycled its states in the programmed order (`fig_clock.png`, decoded sawtooth traces) with no mask update and no JS clock.
- **The failure mechanism is the same dephasing that limits storage** (Exps. 1–3): overlap with the reference states stays
  > 0.95 for ~200 trips (q = 2) to ~100 trips (q = 12), then decays; the first sequence error lands at 0.5–3 × 10³ trips.
  Additive noise up to 1e-3 per trip does not move the first error — the clock is limited by the *optics' mode-phase
  spread*, not by noise. q = 2 shows near-perfect revivals (overlap 0.96 at 5.6e3, 0.93 at 1.8e4 trips), exactly like the dots.
- **Longer cycles are worse.** q = 12 has one-hot contrast ≈ 2 from the start: in phase space the 12 states are rotated
  versions of one field, and in a stable resonator neighbouring rotations overlap strongly. Only the imaging steps are
  localized; intermediate states are fractional-Fourier transforms of the dot. A **one-hot ring counter over 4 or 8
  localized cells was not achievable** with static lenses on this hardware (q = 4/8 need lenses the SLM cannot render; the
  ±I imaging family only gives q = 2).
- **A/B banks for double-buffered synchronous logic exist natively**: the −I ring maps the half-plane x > 0 onto x < 0 every
  trip, i.e. every stored pattern alternates between two banks at 1.5 GHz. What the ring does not provide is logic between
  the banks (see Exp. 8).
- Designed nonlinear toggles / 4-cell ring counters (mask optimisation) are in the Exp. 7–10 design queue; results below.

**Confidence.** High for the linear clocks (deterministic, several noise levels). The q ≤ 25 D feasibility bound is analytic.

## Experiment 2 (nonlinear) — can a designed static mask hold bistable bits permanently?

**Hypothesis.** With local saturable gain + saturable absorber, a static phase program can pin written bit patterns as fixed
points of the round-trip map (true "permanent" storage, as opposed to the finite-horizon linear retention above).

**Hand-built programs** (`02-nl-memory.ts`, `out/02nl/mem_*.csv`, 10 mm steps): π-checkerboard "moat" around 3 px cells on
6–10 px pitch, G0 ∈ {3.0, 3.8}, (s, I_a) ∈ {(−0.6, 0.05), (−0.8, 0.3)}; and no mask with G0 ∈ {1.9, 2.2}. Result: **no
pattern held** (BER 0.27–0.61 at 1500 trips in every case). Moat + low-threshold absorber: *off* cells end brighter
(I 3.3–6.4) than *on* cells (median 0.01–1.6) — on spreads to every cell; high-threshold absorber: every cell dies (the moat
costs ≈ 60 % per trip for a 3 px cell, Exp. 6); no mask, G0 = 1.9: partial memory (BER 0.27–0.39).

**Designed program, round 1** (`08-design.py memory`, torch twin validated to 1e-14, then `08-eval.ts` in JS). 16 cells (3 px,
7 px pitch) on A_img with 10 mm steps, 8 random patterns written by one pulse, targets on trips 50–150, G0 learned
(2.16). Torch reached 99.9 % cell accuracy. **JS re-evaluation to 1e4 trips:** accuracy 0.96–1.00 inside the 150-trip training
window for all 8 patterns — and **every pattern fails at trip 151–158**.

Failure mechanism (`out/08/eval_mem16_lowthr_10000.json`): total field energy grows monotonically (56 → 1300, pattern 0);
the background outside the cells is brighter than the ON cells from trip ≈ 50 (I ≈ 2.5–3); by trip 200 all 16 cells read ON and
stay ON to 1e4. The optimiser did not build bits — it built a slowly lasing field whose invasion of the OFF cells is *timed* to
arrive just after the training horizon. A finite-horizon objective on a gain medium above threshold is gameable in exactly
the same way as the single-horizon dot objective in Exp. 1.

**Round 2** (in progress): same task with T = 300, targets 100–300, plus a stationarity penalty on the last 40 % of the
rollout (cell-intensity change and relative whole-field change per trip), warm-started from round 1. Reported below when done.

## Experiment 19 — wavelength sensitivity (geometry fixed)

**Hypothesis.** "Red for mixing, blue for sharpening": shorter λ gives finer localization (more modes, denser states),
longer λ gives stronger spatial mixing.

**Configuration / method.** A_img and B_4f with every length, focal length, pixel pitch, aperture and grid fixed; λ = 450, 532,
650 nm (SLM/LCD design wavelength unchanged — the program here is zero, so only propagation, lens and aperture physics change).
Explicit operators → eigen-spectrum (Exp. 5 method), coupling matrices (Exp. 4 lattice), flat-FOV packing frontier (Exp. 3;
A ±200 µm, B ±400 µm). `05-extract.ts`, `05-spectrum.py`, `04-coupling.py`, `02-linear-packing.py`, `18-19-compare.py`;
`out/19/wavelength_comparison.csv`, `out/19/fig_wavelength.png`.

**Raw result.**

| config | λ | modes τ_rel > 1e2 / 1e3 / 1e5 | coupling radius t=128 | self-retention of a cell at t=128 | rank at t=16384 | densest lattice with BER=0 for ≥128 trips | densest for ≥1024 trips | longest BER=0 lifetime |
|---|---|---|---|---|---|---|---|---|
| A_img | 450 nm | 454 / 404 / **235** | 106 µm | 0.78 | 63/81 | 278/mm² (60 µm) | **69/mm² (120 µm)** | **2048** |
| A_img | 532 nm | 312 / 276 / 156 | 104 µm | 0.74 | 70/81 | 278/mm² (60 µm) | 69/mm² (120 µm) | 2048 |
| A_img | 650 nm | 200 / 173 / 85 | 106 µm | 0.66 | 69/81 | 278/mm² (60 µm) | 39/mm² (160 µm) | 1024 |
| B_4f | 450 nm | 661 / 574 / **344** | 253 µm | 0.46 | 32/64 | **110/mm² (95 µm)** | none | 512 |
| B_4f | 532 nm | 535 / 471 / 250 | 238 µm | 0.59 | 32/64 | 110/mm² (95 µm) | none | 512 |
| B_4f | 650 nm | 344 / 310 / 155 | 200 µm | 0.62 | 36/64 | 62/mm² (127 µm) | none | 512 |

Finest lattices (A_img, BER = 0): at 40 µm pitch 450 nm lasts 64 trips (phase/dual-rail), 532 nm 8–32, 650 nm 0; at 60 µm
450 nm 256 vs 650 nm 128. Beyond ≈ 100 µm pitch all three wavelengths give the same lifetimes (dephasing ceiling).

**Interpretation.**
- **Blue sharpens — quantitatively ≈ 1/λ² in mode count, not in usable density.** Long-lived mode count scales as (650/λ)^2–2.8
  (A: 85 → 156 → 235), matching the étendue of the relay. The density wall moves by about one lattice step (40 µm becomes
  usable for ~64 trips) and the zero-error lifetime ceiling doubles (1024 → 2048 trips), but the densest ≥128-trip lattice is
  60 µm at every λ in A — the pixel pitch (20 µm) and grid, not λ, bound it there.
- **Red mixes more, but modestly.** At 650 nm a cell keeps 66 % of its light after 128 trips vs 78 % at 450 nm (A); the
  long-horizon interaction radius is 453 µm vs 380 µm. In B the trend is reversed at short horizons (coupling radius 253 µm at
  450 nm vs 200 µm at 650 nm) because the thin-lens phase at fixed dx aliases more strongly at short λ (r_max = λf/2dx shrinks
  from 1.02 mm to 0.71 mm) — a simulator/sampling effect, flagged rather than interpreted physically.
- **Verdict:** "red for mixing, blue for sharpening" is borne out in direction but the magnitude is ≈ 2× in lifetime and
  ≈ 2.8× in mode count between 650 and 450 nm — not a qualitative change in capability.

**Confidence.** High for A (well sampled); medium for B at 450/532 nm (lens-phase aliasing beyond r ≈ 0.7–0.85 mm).

## Experiment 18 — physical-architecture sensitivity (interim; logic and control columns completed below)

**Question.** Do cheaper optics merely reduce efficiency, or do they remove computational capability?

**Method.** No new combinatorial sweep: the most informative subset already measured is collated per architecture by
`18-19-compare.py` (`out/18/architecture_comparison.csv|json`, `out/18/fig_architecture_comparison.png`).
Architectures (§0.2): A = low-loss reflective LCOS ring (self-imaging variant and preset relay), B = linear reciprocal LCD cavity
(4f lens relay, and the lensless style of the shipped preset), C = cheap transmissive LCD + microlens array.

| property | A self-imaging SLM ring | A preset relay | B linear 4f LCD | B lensless | C LCD + MLA |
|---|---|---|---|---|---|
| round-trip time / rate | 0.667 ns / 1.50 GHz | 0.667 ns / 1.50 GHz | 2.669 ns / 0.375 GHz | 2.669 ns / 0.375 GHz | 0.273 ns / 3.67 GHz |
| dominant-mode retention per trip (\|λ1\|²) | 0.684 | 0.672 | 0.628 | 0.619 | 0.597 |
| required round-trip gain to hold the dominant mode | 1.46 | 1.49 | 1.59 | 1.62 | 1.67 |
| modes with τ_rel > 1e2 / 1e3 / 1e5 trips | 200 / 173 / 85 | 111 / 20 / 1 | 344 / 310 / 155 | 29 / 1 / 1 | 29 / 5 / 1 |
| coupling radius at t = 128 / rank of cell map at t = 16384 | 106 µm / 69 of 81 | — | 200 µm / 36 of 64 | — | 777 µm / 3 of 49 |
| best single-dot lifetime (corr ≥ 0.9) | 2371 trips (1.6 µs), σ 57 µm | 1 trip | 1334 trips (3.6 µs), σ 64 µm | — | 24 trips (6.5 ns) |
| densest lattice holding BER = 0 for ≥ 128 trips (flat FOV) | 278 /mm² (60 µm) | — | 62 /mm² (127 µm) | — | none (≤ 32 trips at any pitch) |
| densest lattice holding BER = 0 for ≥ 1024 trips | 39 /mm² (160 µm) | — | none (≤ 512) | — | none |
| reservoir memory capacity (K = 10) / NARMA10 NMSE | (self-imaging hurts: 4.7 / 1.34) | **34.6 / 0.19** | 15.9 / 0.37 | — | 2.8 / 0.87 |

**Interim interpretation.**
- **Loss is not the discriminator.** Required gain differs by only 1.46 → 1.67 across all five; in the noise-free model gain
  compensates loss exactly. What differs by orders of magnitude is *imaging quality*: long-lived modes (85 → 155 → 1),
  state lifetime (≈ 2×10³ → 24 trips) and whether coupling stays local (106 µm vs 777 µm radius).
- **The cheap LCD+MLA stack loses capability, not just efficiency.** Per-lenslet cavities with Fresnel number ≈ 1 and 2 %
  focal scatter have ≤ 5 modes living > 10³ trips, no lattice survives 32 trips, and reservoir memory is 2.8. The shipped
  lensless LCD cavity is worse still for storage (1 mode > 10³ trips).
- **B (linear LCD 4f) is a real option**: more long-lived modes than A (155 vs 85 > 1e5) thanks to its 2 mm lens aperture,
  but 4× slower round trips, 63.5 µm pixels (4× lower areal density) and a vignetted field of view.
- **What a design wants depends on the workload.** Storage wants self-imaging (A or B 4f); reservoir/temporal processing
  wants the non-degenerate relay (A preset). Both are the same hardware with a different lens spacing or one static SLM lens.

## Experiment 17 — streaming control-policy toy (does extra internal recurrence help?)

**Task** (`17-control.py`, `17-plot.py`, `out/17/`). A target performs a smooth 2-D random walk (velocity AR(1), ρ = 0.97) and is
occluded for 20 of every 120 frames. A single-integrator agent is commanded by a 2-D velocity action (|a| ≤ 0.4/frame). Every
frame an egocentric 16×16 camera image (Gaussian target blob relative to the agent, additive noise σ = 0.05) is injected into
the cavity through a static random complex input pattern; the optical state is **never reset**. The expert action is
0.5 × relative position + the target's true velocity — the velocity term is not observable from one frame, so memory helps.
A digital linear readout (ridge, evaluation only) of 16×16-binned log detector intensities is trained by behaviour cloning
plus two DAgger rounds, then evaluated closed loop on 4 unseen 600-frame episodes. Masks stay fixed for the whole episode.

**Optical dynamics.** The exact explicit round-trip operator of the static configuration with constant gain just below
threshold (0.995 per trip on the dominant mode), x ← M^K (x + B·frame), M^K by repeated squaring (validated to 1e-11 at 1e5 trips).
Baselines: memoryless linear readout of the raw frame; ESN-128 (tanh) with the same training protocol; oracle expert.

**Raw result — A_preset (the best reservoir configuration of Exp. 15).**

| policy | optical trips / frame K | frame rate | tracking error | error while occluded | action MSE vs expert |
|---|---|---|---|---|---|
| oracle expert | — | — | 0.146 | — | 0 |
| memoryless linear readout of the frame | — | — | 1.57 ± 1.98 | 2.99 | 0.034 |
| ESN-128 (digital recurrent) | — | — | 0.98 ± 0.68 | 1.65 | 0.038 |
| optical A_preset | 1 | 1.5 GHz | 3.93 ± 3.03 | 5.86 | 0.067 |
| **optical A_preset** | **10** | **150 MHz** | **0.87 ± 0.49** | **1.41** | 0.040 |
| optical A_preset | 100 | 15 MHz | 2.17 ± 2.26 | 3.37 | 0.048 |
| optical A_preset | 1000 | 1.5 MHz | 4.36 ± 3.72 | 5.35 | 0.075 |
| optical A_preset | 10 000 | 150 kHz | 21.0 ± 5.4 | 22.9 | 0.156 |
| optical A_preset | 100 000 | 15 kHz | 21.0 ± 5.4 (identical) | 22.9 | 0.156 |

**Interpretation.**
- **The optical recurrent state does contain useful temporal information:** at K = 10 the static cavity + linear readout beats
  both the memoryless readout (tracking 0.87 vs 1.57; during occlusion 1.41 vs 2.99) and a 128-unit digital tanh reservoir
  (0.98 / 1.65).
- **Giving the same static model more internal recurrences between sensor updates does not help — it hurts, monotonically
  beyond K ≈ 10.** At K = 100 the error is 2.5× the K = 10 optimum, at K = 1000 5×, and at K ≥ 10⁴ the policy is useless:
  M^K has collapsed onto the few longest-lived modes, every frame produces the same detector features, the readout outputs a
  constant and the agent stops (K = 10⁴ and 10⁵ give bit-identical results). The optimum sits where the frame period matches
  the memory spectrum of Exp. 5 (A_preset: 111 modes live > 10² trips, 20 > 10³, 2 > 10⁴).
- K = 1 is also poor with this gain setting: with 0.995/trip the state integrates ~200 frames and new frames are swamped
  (follow-up with faster fading, gain 0.9/trip, below).
- **Key answer:** under this model, 10 000 extra internal recurrences between sensor updates destroy rather than improve the
  policy. Useful recurrence per frame is bounded by the mode lifetime spectrum (~10–100 trips here); the "free" recurrence
  budget of a GHz cavity is not a computational resource for a linear static operator — it is a low-pass filter.

**Pending (queued, reported below):** A_preset with gain 0.9/trip (K = 1, 10, 100); self-imaging A_img (K = 1…1000).
Caveat: the optical dynamics between frames are linear; a nonlinear medium could in principle use recurrence differently —
tested indirectly by Exp. 15 (nonlinear regimes lose memory) but not closed-loop here.

### Experiment 2 (nonlinear) — round 2 result and round 3: absorbing amplitude mask

**Round 2 (phase-only design with stationarity, T = 300) — failed in JS.** Torch reached only 68.5 % cell accuracy with the
fixed-point penalty; in JS all 8 patterns sit at 57–87 % accuracy from trip 100 with zero decision margin and are fully wrong
by trip 301 (`out/08/eval_mem16_stat_T300_10000.json`). The first persistent phase-only circuit (half adder, same method)
failed identically: every non-zero input case wrong by trip 201. **Conclusion: a static phase-only program in a spatially
uniform gain + absorber medium did not produce persistent bits** — nothing stops light spreading between cells, and the
"moat"/phase tricks only scatter it.

**Round 3 — hypothesis.** A static **absorbing** amplitude program (a transmissive LCD in amplitude mode, placed in the SLM
plane: cell pixels clear, gap pixels dark) makes the gaps unable to lase at any gain, so switching fronts cannot propagate and
each cell becomes an independent bistable element. This is a modeled device already in the simulator (`transmissive-lcd`,
`modulation: amplitude`), not a new element.

**Method** (`02-nl-amp.ts`, `out/02nl/amp_*.csv`, logs `out/02nl/logs/amp_*.log`). A_img ring, 64² grid, 1 sample/pixel,
10 mm propagation steps; LCD contrast ideal (dark 0) or 1000:1 (dark 1e-3). Flat FOV ±200 µm. Cells 3–5 px (60–100 µm), gaps
2–4 px; G0 3–6; (s, I_a) ∈ {(−0.6, 0.05), (−0.8, 0.2)}. 3 random patterns per point written by one pulse (I = 2 per cell).
Fixed absolute decoder (threshold I = 0.25). Surviving states get a one-trip fixed-point residual and a Benettin
perturbation-growth estimate (400 trips).

**Result at 3000 trips (first sweep, partial).**

| cells / gap (pitch) | contrast | G0 | s, I_a | BER (3 seeds) | ON mean / OFF max | λ_L per trip (surviving seeds) |
|---|---|---|---|---|---|---|
| **3 px / 3 px (120 µm, 69 bits/mm²)** | **ideal** | **3** | **−0.8, 0.2** | **0 / 0 / 0** | 1.5–1.6 / ≤ 0.006 | **−3.0e-3, −2.1e-3, −1.6e-3** |
| 3 px / 3 px | ideal | 4 | −0.8, 0.2 | 0.33 / 0 / 0 | 3.7 / 0.014 (one seed all-ON) | −1.1e-4, −1.3e-3 |
| 3 px / 3 px | 1000:1 | 4 | −0.8, 0.2 | 0.33 / 0 / 0 | 3.7 / 0.014–0.017 | −5.2e-4, −8.3e-4 |
| 3 px / 2 px (100 µm) | ideal | 3 | −0.8, 0.2 | 0.13 / 0.13 / 0.06 | 1.9 / 2.4–2.6 | — |
| 3 px / 2–4 px | any | 3–6 | −0.6, 0.05 (low threshold) | 0.2–0.67 | every cell ON | — |
| 3 px / 3–4 px | any | 5–6 | −0.8, 0.2 | 0.2–0.67 | every cell ON | — |

The one-trip fixed-point residual of the surviving states is exactly 2.0 = |e^{−iπ} − 1|: the cavity's round-trip carrier
phase is −π, so the *field* alternates sign while the *intensity pattern* is stationary. The negative Lyapunov exponent means a
perturbation shrinks by e^{−1} every 300–600 trips: **a linearly stable fixed point of the modeled dynamics — the first
genuinely persistent bits of the sprint.** Window: needs a 3 px gap (2 px leaks ON state to neighbours through the relay PSF),
the higher-threshold absorber (I_a = 0.2, threshold/ON ≈ 0.15), and G0 ≈ 3 (G0 ≥ 5 makes the OFF state itself unstable).

**Running now:** 3×10⁴-trip (3 seeds) and 10⁵-trip confirmations at ideal and 1000:1 contrast; gain-noise robustness
(1e-4, 1e-3); a fine G0 window scan (2.2–3.8); 2 px cells. The design tooling was extended so the absorbing program is a
second learnable static program (twin validated against JS to 1.6e-14 with the amplitude LCD) — gates, latch, adders,
countdown and associative memory are being re-designed on this architecture (`amp-queue.sh`).

## Experiment 7 — optical wire (static linear transport)

**Hypothesis.** A static phase program can move a stored bit from a source cell to a destination cell and leave it there,
without disturbing neighbouring stored bits.

**Configuration / method** (`08-design.py wire`, `08-eval.ts`, `07-wire-summary.py`, `out/08/eval_wire_*_10000.json`,
`out/08/wire_summary.json`). Self-imaging ring A, 64² grid, 1 sample/pixel, 10 mm propagation steps, **defocus δ = 5 mm**
per trip (round-trip ABCD [[1, δ],[0, 1]], so a local phase tilt displaces light) unless noted; linear optics with a global gain
clamp. One static SLM program per wire designed through the validated twin (targets: destination ON from `settle` to T, source
kept), then **re-evaluated in the JS simulator to 10⁴ trips**. Cells 3 px (60 µm). Latency = first trip the destination exceeds
threshold; efficiency = mean destination intensity after T/2 relative to the injected source intensity.

**Raw result.**

| wire | distance | training horizon T | latency (trips) | trips / px | transfer efficiency | source retained | correct in window | survives to (JS) |
|---|---|---|---|---|---|---|---|---|
| d4 | 80 µm (4 px) | 150 | 4 | 1.0 | 0.21 | 0.23 | 100 % | 550 |
| d8 | 160 µm (8 px) | 60 | 20 | 2.5 | 0.09 | 0.18 | 100 % | 70 |
| **d8, T = 150** | 160 µm | 150 | 19 | 2.4 | **0.44** | 0.44 | 100 % | **10 000 (frozen state)** |
| d16 | 320 µm (16 px) | 150 | 46 | 2.9 | 0.16 | 0.30 | 97 % | 175 |
| d24 | 480 µm (24 px) | 150 | — | — | — | — | 100 % | 273 |
| d8 + 2 spectator bits | 160 µm | 150 | — | — | — | — | 100 % | 2 of 6 cases to 1e4 (others 321–4125) |
| d8, **no defocus** | 160 µm | 150 | — | — | — | — | 100 % | 525 |

**Interpretation.**
- **Wire: yes, as a timed transfer.** Every design moved the bit to its destination inside its training window (latency 1–3
  trips per pixel). Distance costs latency roughly linearly and efficiency sublinearly (0.21 at 80 µm, 0.16 at 320 µm).
- **Holding: only as the cavity's dominant eigenmode.** One design (d8, T = 150) converged to a state with source and
  destination both lit (0.196 / 0.194) that is frozen to 1e4 trips — the designed program made "source + destination" the
  dominant eigenvector, and a global gain clamp sends all light there. Every other wire drifts off within 70–550 trips.
- **Isolation: poor.** With two spectator bits in the field, only 2 of 6 cases (bit combinations) held; the others failed at
  321–4125 trips. A linear gain-clamped cavity has **one** attractor, so independent bits cannot all persist beside a wire.
- **Defocus is convenient, not required**: the same 160 µm wire designed on the un-defocused ring also transfers (survives
  to 525 trips) — the program uses the PSF-scale coupling and aperture filtering.
- **Fan-out and crossings were not attempted** (no persistent single-wire isolation to build on).

**Confidence.** High for what is reported (JS re-evaluation); medium on generality (one design per case, one seed).

## Experiment 8 — static boolean gates (linear part; nonlinear gates on the absorbing-mask architecture are in progress)

**Configuration / method.** As Exp. 7 (defocused ring, linear, gain clamp). One static program per gate handles the whole truth
table; inputs are injected once at t = 1 into input cells; an always-ON "rail" cell provides a phase/power reference for NOT.
Re-evaluated in JS to 1e4 trips (`out/08/eval_gate_lin_*_10000.json`).

| gate | case | correct in training window | survives to (JS) |
|---|---|---|---|
| XOR | 00 → 0 | 100 % | 10 000 |
| XOR | 01 → 1 | 100 % | 10 000 (output settles at 0.22) |
| XOR | 10 → 1 | 100 % | 10 000 (0.22) |
| XOR | 11 → 0 | 100 % | **130** — output then rises to 0.44 and stays |
| NOT (with rail) | 1 → 0 | 100 % | 10 000 |
| NOT (with rail) | 0 → 1 | 100 % | 750 |

**Interpretation.** The static programs do implement the truth tables through interference while the transient lasts, but
**linear gain-clamped logic is not idempotent**: any non-zero input pattern relaxes into the same dominant eigenmode, so the
long-time output depends only on *whether* light was injected, not on *which* combination (XOR 11 ends brighter than 01/10).
Persistent gates must come from the nonlinear medium. The phase-only nonlinear designs failed the persistence test in Exp. 2
(memory and a half adder), so the nonlinear gates, latch and adders are being re-designed with a learnable static absorbing
amplitude program (Exp. 2 round 3); results are appended when their JS evaluations finish.

### Experiment 2 (nonlinear) — round 3 confirmation: persistent bits to 10⁵ trips

Same absorbing-mask configuration (3 px cells, 3 px gaps = 120 µm pitch, 69 bits/mm², flat FOV, 10 mm steps, s = −0.8,
I_a = 0.2), longer and harsher runs (`out/02nl/amp_long_*.csv`, `amp_long1e5_ideal.csv`, `amp_noise*.csv`, `amp_window_*.csv`).

| run | contrast | G0 | noise (additive gain noise, relative) | horizon | BER (seeds) | ON mean / OFF max | λ_L per trip |
|---|---|---|---|---|---|---|---|
| long | ideal | 3.0 | 0 | 3×10⁴ | 0 / 0 / 0 | 1.5–1.6 / ≤ 0.006 | −2.5e-3, −3.8e-4, −8.9e-4 |
| **very long** | ideal | 3.0 | 0 | **10⁵** | **0** | 1.61 / 0.006 | **−2.9e-3** |
| long | 1000:1 | 4.0 | 0 | 3×10⁴ | 0.33 / 0 / 0 | 3.7–3.8 / 0.014–0.017 (seed 1 all-ON) | −1.6e-4, −9.7e-4 |
| window | 1000:1 | 3.0 | 0 | 3000 | 0 / 0 / 0 | 1.5–1.6 / ≤ 0.006 | −2.5e-3, −1.2e-3, −3.6e-3 |
| window | 1000:1 | 3.4 | 0 | 3000 | 0 / 0 / 0 | 2.4–2.6 / ≤ 0.011 | −3.9e-3, −1.7e-4, −2.2e-3 |
| window | 1000:1 | 2.6 | 0 | 3000 | 0.33–0.78 | all cells extinct | — |
| **noise** | ideal | 3.0 | **1e-4** | 10⁴ | **0 / 0 / 0** | 1.5–1.6 / ≤ 0.007 | (not meaningful under noise*) |
| **noise** | ideal | 3.0 | **1e-3** | 10⁴ | **0 / 0 / 0** | 1.5–1.6 / ≤ 0.007 | (not meaningful under noise*) |
| window | ideal | 2.2 / 2.4 / 2.6 | 0 | 3000 | 0.33–0.78 | all cells extinct | — |
| window | ideal | 2.8 | 0 | 3000 | 0 / 0.22 / 0.22 | one seed holds | −3.7e-3 |
| window | ideal | 3.2 | 0 | 3000 | 0 / 0 / 0 | 2.0–2.1 / ≤ 0.009 | −2.6e-3, −6.2e-4, −4.2e-3 |
| stronger absorber (s −0.9, I_a 0.3) | ideal / 1000:1 | 2.2–3.2 | 0 | 3000 | 0.33–0.78 | all cells extinct | — |
| denser: 2 px cells, 3 px gap (100 µm) | ideal | 2.4–3.2 | 0 | 3000 | 0.50–0.63 | extinct | — |

\* The Benettin estimator runs two copies of the trajectory through one noise stream, so the copies receive different noise
samples and separate regardless of stability; with noise only the BER is a valid robustness measure.

**Conclusion (Experiment 2, updated).** In the modeled dynamics a static absorbing amplitude program + static zero phase
program on the self-imaging ring holds random 9-cell bit patterns with **zero errors for 10⁵ round trips (67 µs)**, with a
negative largest Lyapunov exponent at the reached state (a linearly stable fixed point of the intensity map; the field carries
the cavity's −π round-trip phase), tolerant of 1000:1 LCD contrast and of additive gain noise up to 1e-3 of the state power
per trip. Operating window: **G0 ≈ 2.8–3.4** (at 4.0 one seed in three flips all-ON; ≤ 2.6 everything dies) with the
I_a = 0.2 absorber; gaps must be ≥ 3 px. Persistent density in this relay: **69 bits/mm², 9 bits in the flat field**.
This meets the "demonstrable stable fixed point" definition of *permanent* under the modeled (noise-free-gain-memory, thin-lens)
dynamics; physical permanence additionally depends on unmodeled drift.

**Designed toggle (Exp. 10, nonlinear, phase-only, defocused ring) — failed in JS:** 51 % accuracy, first failure at trip 5.

### Experiment 10 — designed sequencers (phase-only, nonlinear medium): failed

Static SLM programs designed through the twin for a 2-cell toggle (period 10 trips) and a 4-cell one-hot ring counter
(period 10 trips) on the defocused self-imaging ring with local gain + absorber (G0 2.2, s −0.6, I_a 0.05), then re-run in JS
(`out/08/eval_toggle_nl_p10_10000.json`, `out/08/eval_ring4_nl_p10_10000.json`):

| design | decoded accuracy inside the 120-trip training window | first wrong state | survives to |
|---|---|---|---|
| 2-cell toggle | 51 % | trip 5 | 121 |
| 4-cell ring counter | 77 % | trip 15 | 121 |

Neither design produced an autonomous sequence even inside its training window. Together with the re-entrant results above:
**static optics can supply a clock only through linear re-entrance (q-periodic ABCD), lasting ~10³ trips; no designed nonlinear
sequencer worked.** An absorbing-mask ring counter was not attempted (not in the queue).

### Experiment 2 (nonlinear) — round 4: gradient-designed absorbing-mask memory

Static phase program + learnable static absorbing amplitude program, jointly optimised through the validated twin
(`A64s_amp`, 1.6e-14 vs JS) at the round-3 operating point (G0 3 learnable, s −0.8, I_a 0.2), stationarity penalty on the last
40 % of a 300-trip rollout, then re-evaluated in JS to 1e4 trips (`out/08/eval_amp_mem9_p6_10000.json`).

| design | cells / pitch | torch accuracy | JS: patterns correct to 10⁴ trips | decision margin (ON/threshold or threshold/OFF, min) |
|---|---|---|---|---|
| **amp_mem9_p6** | 9 cells, 3 px / 6 px (120 µm) | 0.90 | **8 / 8** | 3.7–3.9 |
| amp_mem16_p5 | 16 cells, 3 px / 5 px (100 µm) | 0.84 | **3 / 8** (others fail at trips 425, 600, 925, 1125, 3675) | 1.8–2.9 |

**Interpretation.** Once an absorbing program is available, the same gradient design method that produced only timed transients
in rounds 1–2 produces a persistent memory that holds every tested pattern to 10⁴ trips. Density does not improve by design:
the 100 µm-pitch (2 px gap) lattice fails, as the hand-built 2 px-gap lattice did — the gap must exceed the relay PSF spill.

### Experiment 10 — designed linear one-hot ring counter (4 cells): transient sequencing works

Static SLM program designed for a 4-cell one-hot ring counter (period 10 trips per tick) on the defocused self-imaging ring,
linear optics with a global gain clamp; re-run in JS to 1e4 trips (`out/08/eval_ring4_lin_p10_10000.json`).

| window | decoded by intensity threshold (I > 0.09) | decoded by brightest cell (argmax) | contrast (brightest / second) |
|---|---|---|---|
| trips 1–120 (training, 3 cycles) | 100 % correct inside each tick's settled part | correct c0→c1→c2→c3 every tick | 3–13 inside ticks, ~1.1–1.2 at hand-offs |
| trips 121–160 | first failure at trip 124 (the c3→c0 hand-off is too dim) | still correct (c1 at 140, c3 at 160) | 1.5–14 |
| trip ≈ 200 | lost | c3 still brightest but contrast 1.6 | — |
| trips ≥ 400 | lost | static: all light in one stationary mode, c0 marginally brightest | 1.1 |

**Interpretation.** A single static program *does* produce an autonomous one-hot state progression over 4 localized cells —
~16 correct ticks (≈ 160 trips, 107 ns) with argmax decoding — without any electronic update. It then dissipates into the
cavity's dominant eigenmode, the same single-attractor fate as the linear wires and gates (Exps. 7–8). Together:
**autonomous sequencing is available from static optics for 10²–10³ trips (designed linear ring: ~160; re-entrant cavities:
500–3162), and no nonlinear sequencer has worked yet** (phase-only toggle and ring failed; absorbing-mask toggle and ring are
queued).

### Experiment 17 — follow-ups (complete)

Same task and protocol (`out/17/control_A_preset_gm0.9.json`, `out/17/control_A_img.json`, figure `out/17/fig_control_vs_K.png`).

| optical configuration | per-trip gain on the dominant mode | K = 1 | K = 10 | K = 100 | K = 1000 |
|---|---|---|---|---|---|
| preset relay (main run) | 0.995 | 3.93 ± 3.03 | **0.87 ± 0.49** | 2.17 ± 2.26 | 4.36 ± 3.72 |
| preset relay (faster fading) | 0.9 | 4.21 ± 6.30 | 1.49 ± 1.89 | 20.1 ± 5.2 | — |
| self-imaging ring | 0.995 | 10.4 ± 7.4 | 20.1 ± 13.8 | 1.54 ± 2.03 | 1.54 ± 1.90 |
| memoryless readout / ESN-128 / oracle (digital) | — | 1.57 / 0.98 / 0.15 | | | |

**Interpretation.**
- Faster fading (0.9/trip) did **not** rescue K = 1 (4.2) and made the collapse arrive earlier: at K = 100 the state has decayed
  by 0.9¹⁰⁰ and the policy fails (20.1). The optimum stays at K ≈ 10 but is worse (1.49) than with slow fading (0.87).
- The self-imaging ring is a poor controller at K ≤ 10 (10–20) and at K = 100–1000 only reaches the memoryless baseline
  (1.54 vs 1.57): its near-degenerate long-lived subspace carries the current frame, not its history.
- **Final answer to the key question:** under every tested static configuration, extra internal recurrences between sensor
  updates beyond ~10 trips either destroy the policy (non-degenerate relay) or reduce it to a memoryless readout (self-imaging
  ring). No configuration improved with 10²–10⁵ extra recurrences. The only configuration that beat the memoryless baseline did so
  at K = 10 with slow fading, by an amount comparable to an ESN (0.87 ± 0.49 vs 0.98 ± 0.68, 4 episodes).

### Experiment 8 — persistent gates on the absorbing-mask architecture (in progress)

Static phase program + learnable static absorbing amplitude program designed through the twin (`A64s_amp`), operating point
G0 ≈ 3 (learned 3.49 for AND), s −0.8, I_a 0.2, 3 px cells, inputs written once by a pulse at t = 1 into bistable input cells,
stationarity penalty on the last 40 % of a 200-trip rollout; re-evaluated in JS to 1e4 trips
(`out/08/eval_amp_gate_*_10000.json`). Decoder threshold I = 0.35.

**AND (no rails)** — cells in0, in1 (inputs), out:

| case | expected | output intensity (steady) | output first above threshold | inputs preserved (steady) | correct from settling to 10⁴ trips |
|---|---|---|---|---|---|
| 00 | 0 | 0.000 | never | 0 / 0 | yes |
| 01 | 0 | 0.007 | never | 0.001 / 2.36 | yes |
| 10 | 0 | 0.004 | never | 2.32 / 0.003 | yes |
| 11 | 1 | 1.1–1.6 (fluctuating) | **trip 184** | 2.0–2.6 / 2.4–2.5 | yes (after trip 184) |

**Interpretation.** One static program implements the whole AND truth table as a **persistent, idempotent** output: after
settling, all four cases stay correct with inputs intact to 10⁴ trips (the first gate of the sprint to do so). Settling is slow
— 184 trips (123 ns) for the 11 case, later than its 80-trip training target, so the in-window accuracy reads 71 %. Energy
margins: OFF outputs ≤ 0.007 vs threshold 0.35 (50×); the ON output 1.1–1.6 (3–4×) fluctuates rather than sitting at a fixed
point. Caveat: the learned absorbing program is 50 % clear and the field outside the cells reaches I ≈ 1.2–1.9, so this gate is
not spatially isolated — a neighbouring circuit would see that light (fan-out / composition untested).

**OR (no rails)** — same method (`out/08/eval_amp_gate_OR_10000.json`): **failed.**

| case | expected | output (steady) | output first above threshold | inputs (steady) | outcome |
|---|---|---|---|---|---|
| 00 | 0 | 0.000 | never | 0 / 0 | correct |
| 01 | 1 | 0.006 | never | 0.007 / 2.81 | wrong from trip 80 |
| 10 | 1 | 0.002 | never | 2.75 / 0.006 | wrong from trip 80 |
| 11 | 1 | 0.023 | trip 48, then drops | 2.95 / 2.90 | wrong from trip 80 (brief ON only) |

**AND vs OR.** The same design method and operating point produced a working AND and a failed OR. In both, the inputs latch
correctly; the difference is whether the light one latched input couples into the output cell exceeds the output's switching
threshold. With 3 px bistable cells separated by an absorbing program, a single ON neighbour does not switch a cell (the
property that makes memory persistent); two coincident neighbours can. **The medium natively supports threshold-2 (AND-like)
coupling and resists threshold-1 (OR/wire-like) coupling** — the same isolation that makes bits permanent makes fan-in of one
insufficient. Rails (always-ON power cells) were not used for OR; they are used in the NAND/NOT/XOR designs still running.

**XOR (one always-ON rail cell)** — `out/08/eval_amp_gate_XOR_10000.json`: **failed.**

| case | expected | output (steady) | output ever above threshold | inputs / rail (steady) | outcome |
|---|---|---|---|---|---|
| 00 | 0 | 0.000 | never | 0 / 0.001 / rail 2.02 | correct to 10⁴ |
| 01 | 1 | 0.001 | never | 0.002 / 2.17 / rail 1.98 | wrong from trip 80 |
| 10 | 1 | 0.000 | never | 1.95 / 0.003 / rail 2.01 | wrong from trip 80 |
| 11 | 0 | 0.000 | never | 1.94 / 2.26 / rail 2.08 | correct to 10⁴ |

The design converged to "output always OFF" (50 % of the truth table). All inputs and the rail latch correctly and persist;
the output never switches in any case, even when one input plus the rail (two ON neighbours) should drive it. The optimiser could
not find a static program in which the 01/10 drive exceeds the output threshold while the 11 drive (one more ON source) does not —
XOR needs a non-monotone response (destructive interference), and the bistable cells' ON phase is set by their own write pulse and
the cavity, so a fixed interference relation between latched inputs was not found.

**NAND (one always-ON rail cell)** — `out/08/eval_amp_gate_NAND_10000.json`: **failed.**

| case | expected | output (steady) / first ON | in0 / in1 steady (written) | rail | light outside cells | outcome |
|---|---|---|---|---|---|---|
| 00 | 1 | 1.54 / trip 53 | 0.002 / 0.003 (0 / 0) | 2.12 | 3.2 | correct to 10⁴ |
| 01 | 1 | 1.30 / trip 64 | **0.32** / 2.03 (0 / 1) | 2.33 | 2.8 | output right, but in0 drifts ON; fails at 243 |
| 10 | 1 | 1.54 / trip 53 | **0.002** / 0.003 (1 / 0) | 2.12 | 3.3 | output right, but **input in0 erased**; fails at 201 |
| 11 | 0 | **1.32** / trip 61 | **0.34** / 2.11 (1 / 1) | 2.26 | 3.4 | output wrong, in0 degraded |

The design learned "output always ON, powered by the rail" (3 of 4 outputs right) and in doing so flooded the gate region with
rail light (I ≈ 3 outside the cells) that corrupted a stored input. **The rail that a monotone medium needs for inversion is also
the main source of cross-talk**; with the tested absorbing programs, inversion (NAND, NOT via rail) and isolation were not
achieved together.

**NOT (one always-ON rail cell)** — `out/08/eval_amp_gate_NOT_10000.json`: **failed.**

| case | expected | output (steady) | output ever above threshold | input / rail (steady) | outcome |
|---|---|---|---|---|---|
| 0 | 1 | 0.014 | never | 0.001 / 2.34 | wrong from trip 80 |
| 1 | 0 | 0.014 | never | 1.54 / 2.32 | correct to 10⁴ |

### Experiment 8 — gate scorecard (absorbing-mask architecture, JS to 10⁴ trips)

| gate | static program found | cases correct at steady state | persistent after settling | inputs preserved | failure mode |
|---|---|---|---|---|---|
| **AND** | yes | **4 / 4** | **yes** (settles by trip 184) | yes | — |
| OR | yes | 1 / 4 | — | yes | output never switches from a single input |
| XOR (rail) | yes | 2 / 4 | — | yes | output stuck OFF |
| NAND (rail) | yes | 3 / 4 | — | **no** (rail light erased an input) | output stuck ON |
| NOT (rail) | yes | 1 / 2 | — | yes | output stuck OFF |

**Why exact gates are mostly impossible here** (the Exp. 8 question). Every design latches its inputs and rail correctly — memory
works — but the output cell responds to coupled light only through a bistable threshold. The isolation that makes a cell
permanent means one ON source cannot switch it (OR, NOT-via-rail fail with the output stuck OFF), while any coupling strong enough
to switch it from the rail floods neighbours (NAND stuck ON, input erased). Only a threshold-2 function (AND: two coincident ON
inputs) falls inside the window. Non-monotone functions (XOR) and inversion would need a fixed interference phase between
independently written cells, which a phase-insensitive gain medium does not provide. **With these element models, universal
persistent logic was not achieved; AND alone is not functionally complete.** Persistent wire (threshold-1 copy) and OR with a
rail are queued as the direct test of the missing primitive.

## Experiment 9 — persistent latch / register (absorbing-mask architecture)

**Hypothesis.** With persistent bistable cells available (Exp. 2), a static program can route a SET pulse into Q and a RESET
pulse (arriving π out of phase in its own region) out of Q, so Q follows the last control pulse and holds.

**Configuration / method.** `08-design.py latch` on `A64s_amp` (phase + learnable absorbing program, G0 ≈ 3, s −0.8, I_a 0.2,
3 px cells, S and R injection cells 6 px from Q, one always-ON rail), stationarity penalty; pulses at trip 60 (and a second
pulse at 140 for the sequence cases); re-evaluated in JS to 1e4 trips (`out/08/eval_amp_latch_10000.json`). Threshold I = 0.35.

**Raw result (Q intensity).**

| case | expected Q | t = 59 | t = 90 | t = 150 | t = 240 | t = 1000 | t = 10000 | outcome |
|---|---|---|---|---|---|---|---|---|
| hold 0 | 0 | 0.05 | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 | correct to 10⁴ |
| hold 1 | 1 | 0.51 | 0.43 | 0.42 | 0.42 | 0.42 | 0.42 | correct to 10⁴ (margin 1.2×) |
| set from 0 | 0 → 1 | 0.05 | 0.17 | 0.19 | 0.38 | 0.49 | 0.63 | sets, but only by trip ≈ 240 (latency ≈ 180 trips) |
| set from 1 | 1 | 0.51 | 0.50 | 0.39 | 0.65 | 0.46 | 0.61 | stays set |
| reset from 1 | 1 → 0 | 0.51 | 0.35 | 0.32 | 0.33 | 0.33 | 0.33 | **not reset**: drops only to 0.33, just under threshold (OFF level is 0.04) |
| reset from 0 | 0 | 0.05 | 0.05 | 0.04 | 0.04 | 0.04 | 0.04 | stays reset |
| set → reset | 1 → 0 | 0.05 | 0.17 | 0.20 | 0.44 | 0.48 | 0.62 | **reset ignored** — Q ends ON |
| reset → set | 0 → 1 | 0.51 | 0.35 | 0.38 | 0.39 | 0.51 | 0.40 | ambiguous (0.3–0.5 around threshold); fails at 675 |

Rail ≈ 1.6–2.4; light outside the cells 1.6–3.1.

**Interpretation.** HOLD works in both states (the persistent-bit result of Exp. 2 carries over), and SET works slowly (≈ 180
trips, 120 ns) and weakly (ON level 0.4–0.6 vs 1.5–2.5 for an isolated memory cell). **RESET was not achieved**: a π-phased
reset pulse only dims Q to the threshold, and a later SET or the rail's spill turns it back on. Resetting a bistable cell needs
either destructive interference with Q's own field (Q's phase is set by its write history and the cavity, not by the static
program) or an inhibitory nonlinearity; the element set has neither (local gain and absorbers are phase-insensitive and act only
on the sample's own intensity). **Controlled update of machine state — the prerequisite for a register — was not demonstrated.**
Multiple adjacent registers were therefore not tested.

**Confidence.** Medium-high for this design and operating point (one design, JS-verified); a different nonlinearity could change
the conclusion, a different phase/absorbing program within the same element set did not in rounds 1–4.

## Experiment 11 — small combinational arithmetic (in progress)

**Method.** Direct whole-circuit optimisation (one static phase program + learnable absorbing program on `A64s_amp`, operating
point G0 3, s −0.8, I_a 0.2, 3 px cells, one rail) of the truth table, inputs written once at t = 1, outputs required from trip 80
to 240 with the stationarity penalty; re-run in JS to 1e4 trips. Composition from individually characterized gates was not
attempted, because only AND survived as a persistent gate (Exp. 8).

**Half adder** (`out/08/eval_amp_bool_halfadd_10000.json`): **failed by total collapse.**

| case | expected sum, carry | steady state (i0, i1, sum, carry, rail) | correct |
|---|---|---|---|
| 00 | 0, 0 | 0, 0, 0, 0, 0 | yes (trivially) |
| 01 | 1, 0 | 0, 0, 0, 0, 0 | carry only |
| 10 | 1, 0 | 0, 0, 0, 0, 0 | carry only |
| 11 | 0, 1 | 0, 0, 0, 0, 0 | sum only |

Every cell, including both written inputs and the always-ON rail, goes dark: the design sits in the trivial dark attractor
(50 % of output bits "correct" only because they are dark). The full adder (`eval_amp_bool_fulladd_10000.json`) does the same:
000 is correct only because every output should be dark; 001–110 are 50 % correct, 111 is 0 %, and every non-zero case fails
from trip 80.

**Diagnosis: this was a setup error on my side, not a result about what the optics can do.** The training loss was *exactly*
constant from iteration 0 (0.135 half adder, 0.180 full adder). The field died before the first target window, so every
gradient was zero and the masks never changed. The cause is the task layout (`task_boolfn` defaults): cells 3 px wide with only
**2 px gaps**, which Exp. 2nl had already shown cannot hold bits on this architecture. On top of that, the outputs were 37 px
from the inputs and the rail was 23 px from every cell, and the inputs were not required to stay on. The gates, which converged,
used 6 px spacing and required inputs to stay on. These two runs therefore say nothing about compiling adders. They are rerun
in `amp-queue2.sh` (tags `amp2_bool_*`) with 3 px gaps, input and output columns 18 px apart, the rail 10 px below and
inputs required to stay on.

## Experiment 12 — machine-code substrate (stop condition applied; fallback in progress)

**Decision.** The tiny accumulator ISA was **not** implemented optically. That is a planned stop, not a skipped step. From
`14-circuits.py`, one accumulator step needs 25 bits of persistent state that the machine itself writes: ACC, PC, 4 RAM cells and
a halt flag. Every one of those bits has to be SET and RESET under the control of other optical bits. The step also needs about
316 gates, including XOR (adder sum), NOT/mux (next PC) and OR. The measurements so far give:

| prerequisite | measured status (this sprint) | source |
|---|---|---|
| persistent bits | **yes**: absorbing mask, BER 0 to 10⁵ trips, 69 bits/mm² | Exp. 2nl |
| a bit stays set while its neighbours change | yes, for isolated cells (hand-built and designed lattices) | Exp. 2nl |
| controlled SET of a bit | slow and weak (≈ 180 trips, ON level 0.4–0.6) | Exp. 9 |
| controlled RESET of a bit | **no** | Exp. 9 |
| persistent threshold-2 gate (AND) | yes | Exp. 8 |
| persistent OR / NOT / XOR / NAND | no | Exp. 8 |
| clock with no JS in the loop | yes: re-entrant cavity (q = 2…12, ≈ 10³–3×10³ trips before dephasing) | Exp. 10 |
| clock-driven transfer of state between cells | no (phase-only toggle/ring fail; linear ring ≈ 16 ticks) | Exp. 10 |

Without RESET and without an inverting or non-monotone persistent gate, the optics cannot overwrite ACC or PC, so there is no
machine to load `ldi 3; store x; ldi 4; add x; halt` into. Building a "machine" anyway would have meant JS applying the
next-state logic, which the brief rules out.

**Fallback: a static spatial transition graph** (`08-design.py countdown`, `amp-queue2.sh`, tag `amp_countdown4`). The program is
`x = n; while (x != 0) x--; halt`, written as five cells c0…c4 on a 6 px step. A one-hot token is written into cell c_n at
t = 1 (n = 1…4, four cases). It must move to c_(n−1) every 20 trips (6 trips allowed for each transition) and then stay in c0,
the HALT state, until T. This asks whether a static program can run a fixed, data-dependent sequence of state changes that ends
in a stable state, the simplest thing a program counter does. The result will be added here.

## Experiment 18 — architecture sensitivity: logic and control columns (final)

The interim table above covers storage, modes, coupling and reservoir memory. The columns that needed Exps. 7–10 and 17 are
filled in below. **"not tested" means that architecture was not tried for that capability. It does not mean the capability was
shown to be impossible there.** Designs were only attempted on A, where storage worked best, and the reasons below explain why
B and C were not attempted.

| capability | A self-imaging SLM ring (+ absorbing LCD plane) | A preset relay | B linear 4f LCD | C LCD + MLA |
|---|---|---|---|---|
| persistent bit (≥ 10⁵ trips) | **yes** (absorbing mask, 120 µm pitch) | no (1-trip dot lifetime) | not tested nonlinearly; linear dots ≤ 1334 trips | no (≤ 24 trips linear) |
| transient wire (designed, linear) | d = 4–24 px: 175–550 trips; d = 8 holds 10⁴ (eigenmode) | — | not tested | not tested |
| persistent gate | AND only (Exp. 8) | — | not tested | not tested |
| latch hold / set / reset | yes / slow / **no** | — | not tested | not tested |
| autonomous clock | re-entrant q = 2, 5, 7, 12 (lens-tuned) | — | not tested | — |
| streaming control, best NMSE (oracle 0.146, ESN 0.98) | 1.54 (K = 1e3) | **0.87** (K = 10) | not tested | not tested |

**Why logic was only attempted on A.** Every persistent result depends on (i) cells that survive 10³+ trips in the linear
cavity and (ii) coupling that stays local over the settling time (≈ 100–200 trips). C fails (i) at every pitch (Exp. 2/3), so a
nonlinear design there has nothing to hold its state in. The lensless B cavity has one mode with τ > 10³ trips, and the 4f
version has a 63.5 µm pixel and a 4× longer trip. B-4f is the one untested candidate that could plausibly work: it has more
long-lived modes than A (155 vs 85). It is listed under next experiments.

**Answer to the Exp. 18 question.** Cheaper optics take away capabilities, not just efficiency. The order of what survives is
set by imaging quality, not by loss: storage → local coupling → logic. The LCD + MLA stack already loses the first step. The
same A hardware also switches roles depending on one static lens setting: self-imaging is good for storage and logic, while the
preset relay is good for reservoir and control workloads (Exps. 15, 17).

### Experiment 10 — designed sequencers on the absorbing-mask architecture

**Toggle (2 cells, period 10 trips; `A64sd5_amp`: defocus δ = 5 mm, learnable absorbing program, G0 ≈ 3, s −0.8, I_a 0.2)**,
`eval_amp_toggle_p10_10000.json`: **failed, no oscillation.** The token written into c0 (I = 0.55 at t = 2) decays steadily:
0.46 at t = 10, 0.24 at t = 20, 0.007 at t = 28. c1 never gets above 3×10⁻⁵, and the whole field is extinct by t ≈ 60 (energy
10⁻¹⁶). Training reached only 54 % accuracy, which is mostly the "OFF" samples, so the optimiser found no program that moves
light out of a latched cell and back. This matches the physics behind the latch failure (Exp. 9). Defocus gives the transport
a cell needs for an exchange, but the saturable absorber on the receiving cell eats the transferred light before it can reach
threshold. If the transport is strong enough to switch the receiver, the source is no longer latched.

**4-cell one-hot ring counter (period 10 trips, same architecture)**, `eval_amp_ring4_p10_10000.json`: **failed, the same way as
the toggle.** c0 goes 0.58 at t = 1, 0.39 at t = 10, 0.04 at t = 20, 3×10⁻⁴ at t = 25. c1–c3 never get above 1.5×10⁻⁴, and the
field is extinct by t ≈ 40. The 77 % training accuracy comes entirely from correctly-OFF samples. **On the absorbing-mask
architecture, nothing was found that moves state from cell to cell under its own clocking.** The only working sequencers are
still linear (the ring counter, ≈ 16 ticks) or cavity re-imaging (re-entrant clocks), and neither stores state persistently.

---

## Experiment 20 — closing synthesis: capability envelope, surprises, implications, next experiments

**Status when the sprint was closed.** Experiments 1–10, 15, 17, 18 and 19 are complete. 11 and 12 are partial, and 13/14
covers the native/netlist side only. Stopped unrun when the machine had to be packed: the Exp. 11 adder reruns beyond the half
adder (full adder, saturating step, parity4), the phase-only transient compilations (`11t2-queue.sh`), the Exp. 12 countdown
fallback, the Exp. 16 associative memory and basin study, and the persistent wire / OR-with-rail test (`amp-wire-queue.sh`). All
of those scripts are committed and restart from where they stopped (each design skips work whose `_spec.json` already exists).
Exp. 16 therefore has **no result**, and none is claimed.

### Executive findings

1. **A static optical program *can* hold permanent digital state, but only with a static absorbing (amplitude) plane added
   to the saturable-gain cavity.** 3 px cells on a 6 px (120 µm) pitch = 69 bits/mm² ran with zero bit errors for **10⁵ round
   trips (67 µs)**. This was measured directly with a full 64² field, at noise 10⁻³ and 1000:1 contrast. The fixed point is
   contracting (λ ≈ −2.9×10⁻³/trip), so the bits are expected to persist indefinitely in the model. That is an extrapolation
   from the local stability exponent, not a measurement past 10⁵. Phase-only programs, moats and every linear configuration
   failed to hold state permanently.
2. **Linear (gain-clamped) PHASER stores only transient state.** The density × lifetime frontier is ≈ 4×10⁴ bit-trips/mm²:
   278 bits/mm² for 128 trips (85 ns), 39 bits/mm² for 1024 trips at 650 nm, 69/mm² for 2048 trips at 450 nm. Every lattice
   fails by 2–4×10³ trips from mode dephasing, verified with exact operator powers to 10⁶. The best single dot lasts
   2371 trips (1.6 µs, σ = 57 µm).
3. **Logic stops at a threshold-2 gate.** Persistent AND worked. OR, NOT, XOR and NAND did not. A latch holds and sets, but
   **cannot be reset**, and no designed sequencer (toggle, ring) moved state from cell to cell. The gain and absorbing elements
   respond only to local intensity, not phase, so the element set has no inhibition and no persistent inversion.
   **PHASER as modelled is a memory, not a CPU.** The machine-code substrate (Exp. 12) was stopped at its prerequisite, as the
   brief required.
4. **Transient linear computation works:** XOR by interference (≈ 130 trips), NOT from a rail, wires over 4–24 pixels
   (175–550 trips), a linear 4-cell ring counter (≈ 16 ticks), and self-clocking re-entrant cavities (q = 2…12, 500–3000 trips).
5. **Where the optics clearly help is temporal processing.** At K = 10 recurrences per input, the non-degenerate preset relay
   is a strong reservoir: memory capacity 34.6 vs 7.1 for a matched ESN, NARMA10 NMSE 0.19 vs 0.66. On a streaming control
   toy it beats the memoryless policy (0.87 vs 1.57) and the ESN (0.98), though not the oracle (0.146).
6. **Extra internal recurrences did not help.** At 10⁴–10⁵ recurrences per frame, control NMSE gets worse (21.0) as the field
   relaxes to its dominant modes. The useful regime is K ≈ 10–10³ recurrences per frame.
7. **Architecture quality is the discriminator, not loss.** The cheap LCD + MLA stack loses storage entirely (≤ 24 trips).
   The linear 4f LCD cavity has more long-lived modes than the SLM ring (155 vs 85) but is 4× slower and 4× coarser.
   Wavelength is a ≈ 2–3× knob, not a qualitative one.

### Capability envelope (A = self-imaging reflective SLM ring, 650 nm, 20 µm pixels, trip 0.667 ns)

| capability | best achieved | lifetime / reliability | physical time | evidence |
|---|---|---|---|---|
| persistent storage | 69 bits/mm² (120 µm) | BER 0 to 10⁵ trips, noise ≤ 10⁻³ | ≥ 67 µs measured; indefinite extrapolated | direct (JS, full field) |
| transient storage, dense | 278 bits/mm² (60 µm) | BER 0 for 128 trips | 85 ns | direct (exact operator) |
| transient storage, long | 39 bits/mm² (160 µm) | BER 0 for 1024 trips | 0.68 µs | direct |
| single echo | σ 57 µm dot | corr ≥ 0.9 for 2371 trips | 1.6 µs | direct |
| long-lived modes | 85 modes, τ > 10⁵ trips | — | > 67 µs | direct (eigen) |
| optical wire | 4–24 px | 175–550 trips (d = 8: 10⁴ via eigenmode) | 0.1–0.4 µs | direct (designed + JS) |
| persistent gate | AND | 4/4, settles by 184 trips, held to 10⁴ | 123 ns settle | direct |
| transient gate | XOR (linear) | fails at 130 trips | 87 ns | direct |
| latch | hold + set | set ≈ 180 trips; **no reset** | 120 ns set | direct |
| autonomous clock | re-entrant q = 2…12 | 10³–3×10³ trips before dephasing | 0.7–2 µs | direct |
| state sequencing | linear ring4 | ≈ 16 ticks | ≈ 100 ns | direct; nonlinear sequencers failed |
| arithmetic (half adder) | not achieved in the first (invalid-layout) run; corrected rerun in the addendum at the end | — | — | direct |
| machine-code execution | **not possible** with this element set | — | — | inferred from missing RESET/inversion |
| reservoir (K = 10) | MC 34.6, NARMA10 0.19 | — | 6.7 ns/input → 150 MHz input rate | direct (digital linear readout) |
| streaming control | NMSE 0.87 (K = 10) | best K = 10–10³ | 6.7 ns–0.67 µs/frame | direct |

**Prototype estimates (extrapolated from the envelope, not measured).** On a 1920×1080 LCOS (38 × 22 mm), the persistent
lattice at 120 µm pitch gives ≈ 58 k bits. The 60 µm transient lattice gives ≈ 230 k bits for 85 ns. The input rate is limited
by the 0.667 ns trip × K recurrences, so ≈ 150 MHz at K = 10. A second assumption hides in these numbers: the thin-element,
ideal-lens model makes gain compensate loss exactly. A real ring with 30–40 % round-trip loss needs a gain medium with
G ≈ 1.46–1.67 and bistable saturation at the cell scale. That is the least certain assumption behind finding 1.

### Surprises

- **The preset (shipped) relay is useless for storage (1-trip dots) and the best reservoir.** The same hardware switches
  between these roles with one lens spacing or one static SLM lens.
- **A plain absorbing amplitude plane was the missing element.** Moats, phase-only programs and gradient-designed phase masks
  never produced permanent bits. A binary-looking absorbing pattern did at the first operating point tried.
- **Dephasing, not loss, limits linear memory.** Gain clamps loss exactly, but the ~5×10⁻⁴ rad/order eigenphase spread
  scrambles lattices by 2–4×10³ trips and gives partial revivals at ≈ 2.3×10⁴.
- **A designed wire at d = 8 "held" to 10⁴ trips** by routing its bit into a long-lived eigenmode. A transient channel can
  masquerade as memory, which is why the 10⁵-trip and exact-operator checks mattered.
- **1 % focal error cuts dot lifetime by 40×**, and a random SLM program by 8–100×. Geometric precision matters more than
  optical loss.
- **Two layout errors in design tasks** (2 px gaps, Exp. 11) produced exactly flat losses. A flat loss from iteration 0 means a
  dead field, not a converged design. This is recorded so later readers don't take those runs as physics.

### Architecture implications

1. **Add a static absorbing plane** (a second LCD in amplitude mode, or a patterned absorber) next to the SLM. It is the
   cheapest change that turns a transient medium into a persistent one.
2. **Logic needs a phase-sensitive or inhibitory nonlinearity** (e.g. a χ⁽²⁾/interferometric switch, cross-gain saturation
   between cells, or an injection-locked reference) to get RESET and inversion. Without one, stop at memory plus
   AND/threshold logic and use PHASER as a memory, reservoir or associative co-processor, not as a CPU.
3. **Keep self-imaging and non-degenerate relays both available** (one programmable lens): storage/logic vs temporal
   processing.
4. **Build to imaging-quality tolerances** (< 0.1 % focal error, a low-aberration relay). Pay for pixels and optics before gain
   budget. Avoid the LCD + MLA route for anything stateful.
5. **Run workloads at 10–10³ recurrences per input.** Longer internal dwell loses information to mode relaxation.

### Next five experiments

1. **Cross-gain / inhibitory coupling element** (a shared saturable gain between two cells, or a phase-referenced injection).
   Re-run the latch RESET and NOT/XOR gate tasks. This is the single test that decides whether a CPU path exists.
2. **Finish the stopped queue:** the adder reruns with the corrected layout, the countdown transition graph, associative
   memory basins (Exp. 16), and the persistent wire / OR-with-rail (threshold-1 coupling).
3. **Absorbing-mask memory on B-4f**, which has the most long-lived modes. Check whether 155 modes and a slower trip give
   denser or more noise-robust persistent bits.
4. **Real-device non-idealities on the persistent lattice:** SLM phase flicker and quantization, finite gain bandwidth and
   spatial hole burning, ±0.5 % focal error, and a 10⁶-trip JS run with noise, to test the "indefinite" extrapolation.
5. **Associative memory / attractor readout vs a Hopfield baseline** on the absorbing lattice. It is the computation that
   fits the strength that was actually demonstrated (many persistent, locally coupled threshold units).

### Addendum — Experiment 11 half adder, corrected layout (`amp2_bool_halfadd`, JS to 10⁴ trips)

Layout: 3 px cells on a 6 px step, input and output columns 18 px apart, rail 10 px below, inputs required to stay latched
(`amp-queue2.sh`). Cell intensities, threshold 0.35:

| case | expected sum, carry | i0, i1 at t = 240 | sum at 79 / 240 / 10⁴ | carry | rail | correct |
|---|---|---|---|---|---|---|
| 00 | 0, 0 | 0, 0 | 0 / 0 / 0 | 0 | 0 | both bits |
| 01 | 1, 0 | 0, 3.46 | 0 / 0 / 0 | 0 | 0 | carry only |
| 10 | 1, 0 | 3.92, 0.01 | 0.04 / 0.64 / 0.50 | 0 | 0 | **both bits** (sum ON at 0.5–0.64) |
| 11 | 0, 1 | 3.64, 3.38 | 0.03 / 0.07 / **0.83** | 0 | 0 | neither (sum drifts ON by 10⁴) |

**Result: not a half adder (2/4 cases, 5/8 bits), but the layout fix changed the physics.** Unlike the first run, the
written inputs now latch permanently (I ≈ 3.4–3.9 to 10⁴ trips). The optimiser learned only a **threshold-1 persistent copy
i0 → sum across 18 px**: weak (ON level 0.5–0.64) and slow (it crosses threshold between trips 80 and 240). That copy is the
primitive that OR and wires need, and the Exp. 8 gate runs did not find it. It does not tell the two inputs apart: with both
inputs ON the sum keeps drifting up (0.83 at 10⁴) instead of being cancelled. Carry (AND) never turns on, and the rail dies.
This fits the Exp. 8 conclusion that intensity-only elements allow monotone thresholds but not the cancellation XOR needs.
Confidence: medium (one design, 250 iterations, loss still slowly decreasing at stop).
