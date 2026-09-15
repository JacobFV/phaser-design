// Generates the findings canvas artboards (.dc.html) from the measured numbers in ../REPORT.md / ../out/.
// Charts are computed here (log scales, ticks) so geometry is exact. Run: node build.mjs
import { writeFileSync } from 'node:fs'

const C = { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', ink: '#f2f2f2', dim: '#9a9a9a', faint: '#6a6a6a', line: '#222222', line2: '#3a3a3a', panel: '#0a0a0a', ok: '#8fd6a4', warn: '#e6c07a', bad: '#ff7a7a', info: '#9fc3ff' }
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace"
const SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"

const page = (inner) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap">
  <style>
    body { margin: 0; background: #000000; color: ${C.ink}; font: 15px/1.5 ${SANS}; -webkit-font-smoothing: antialiased; font-feature-settings: 'tnum' 1; }
    a { color: ${C.ink}; text-decoration-color: ${C.line2}; } a:hover { color: ${C.info}; }
    h1, h2, h3, p { margin: 0; }
    .badge { display: inline-block; font: 500 10px/16px ${MONO}; padding: 0 6px; border-radius: 3px; border: 1px solid ${C.line2}; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; color: ${C.dim}; }
    .b-measured { color: ${C.ok}; border-color: #2a4a33; }
    .b-validated { color: ${C.info}; border-color: #2c3d5a; }
    .b-extrap { color: ${C.warn}; border-color: #4d3f22; }
    .b-fail { color: ${C.bad}; border-color: #4a2222; }
    .b-pending { color: ${C.dim}; border-color: ${C.line2}; }
    table { border-collapse: collapse; width: 100%; }
    th { text-align: left; font: 400 10.5px/1.3 ${MONO}; text-transform: uppercase; letter-spacing: 0.08em; color: ${C.faint}; padding: 8px 10px; border-bottom: 1px solid ${C.line2}; vertical-align: bottom; }
    td { font-size: 13.5px; line-height: 1.45; padding: 9px 10px; border-bottom: 1px solid ${C.line}; vertical-align: top; text-wrap: pretty; }
    td.num { font-family: ${MONO}; font-size: 13px; white-space: nowrap; }
    svg text { font-family: ${MONO}; }
  </style>
</helmet>
${inner}
</x-dc>
</body>
</html>
`

const label = (t, extra = '') => `<div style="font: 600 11px/1 ${MONO}; text-transform: uppercase; letter-spacing: 0.14em; color: ${C.dim}; ${extra}">${t}</div>`
const frame = (title, kicker, inner, h) => `<div style="width: 1280px; min-height: ${h}px; background: #000000; padding: 52px 56px 56px; box-sizing: border-box; display: flex; flex-direction: column; gap: 28px;">
  <div style="display: flex; flex-direction: column; gap: 12px; padding-bottom: 20px; border-bottom: 1px solid ${C.line};">
    ${label(kicker)}
    <h1 style="font: 500 34px/1.15 ${SANS}; letter-spacing: -0.01em; color: ${C.ink}; text-wrap: balance; max-width: 1040px;">${title}</h1>
  </div>
  ${inner}
</div>`
const panel = (inner, extra = '') => `<div style="background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 8px; padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; ${extra}">${inner}</div>`
const badge = (kind, text) => `<span class="badge b-${kind}">${text}</span>`
const legend = (items) => `<div style="display: flex; flex-wrap: wrap; gap: 8px 18px;">${items.map((it) => `<div style="display: flex; align-items: center; gap: 8px; font: 12px/1 ${MONO}; color: ${C.dim};"><svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><line x1="1" y1="6" x2="21" y2="6" stroke="${it.color}" stroke-width="2" stroke-dasharray="${it.dash ?? ''}" stroke-linecap="round"></line>${it.dash ? '' : `<circle cx="11" cy="6" r="${it.hollow ? 4 : 3.5}" fill="${it.hollow ? '#0a0a0a' : it.color}" stroke="${it.hollow ? it.color : 'none'}" stroke-width="2"></circle>`}</svg>${it.name}</div>`).join('')}</div>`

// ── log-log line chart ────────────────────────────────────────────────────────────────────────────
function logChart({ w = 568, h = 340, x: [x0, x1], y: [y0, y1], xTicks, yTicks, xLabel, yLabel, series = [], hlines = [], vlines = [], zeroRow = null, guides = [] }) {
  const m = { l: 60, r: 18, t: 14, b: 50 }
  const zr = zeroRow ? 30 : 0
  const X = (v) => m.l + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (w - m.l - m.r)
  const Y = (v) => (v <= 0 && zeroRow ? h - m.b - 12 : m.t + (1 - (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * (h - m.t - m.b - zr))
  const fmt = (v) => (v >= 1e4 ? `10${sup(Math.round(Math.log10(v)))}` : `${v}`)
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" style="display: block; max-width: 100%;">`
  for (const t of yTicks) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.line}" stroke-width="1"></line><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${C.faint}">${fmt(t)}</text>`
  if (zeroRow) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${h - m.b - 12}" y2="${h - m.b - 12}" stroke="${C.line}" stroke-width="1" stroke-dasharray="2 4"></line><text x="${m.l - 8}" y="${h - m.b - 8}" text-anchor="end" font-size="11" fill="${C.faint}">${zeroRow}</text>`
  for (const t of xTicks) s += `<text x="${X(t)}" y="${h - m.b + 18}" text-anchor="middle" font-size="11" fill="${C.faint}">${fmt(t)}</text><line x1="${X(t)}" x2="${X(t)}" y1="${h - m.b}" y2="${h - m.b + 4}" stroke="${C.line2}"></line>`
  s += `<line x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}" stroke="${C.line2}" stroke-width="1"></line>`
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 10}" text-anchor="middle" font-size="11" fill="${C.dim}">${xLabel}</text>`
  s += `<text transform="translate(14 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${C.dim}">${yLabel}</text>`
  for (const v of vlines) s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${h - m.b}" stroke="${C.line2}" stroke-dasharray="3 4"></line><text x="${X(v.x) + 5}" y="${m.t + 12}" font-size="10.5" fill="${C.faint}">${v.label}</text>`
  for (const g of guides) {
    const pts = g.pts.map(([a, b]) => `${X(a)},${Y(b)}`).join(' ')
    s += `<polyline points="${pts}" fill="none" stroke="${C.faint}" stroke-width="1" stroke-dasharray="4 4"></polyline><text x="${X(g.at[0])}" y="${Y(g.at[1])}" font-size="10.5" fill="${C.faint}">${g.label}</text>`
  }
  for (const hl of hlines) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(hl.y)}" y2="${Y(hl.y)}" stroke="${C.dim}" stroke-width="1.2" stroke-dasharray="5 4"></line><text x="${w - m.r - 4}" y="${Y(hl.y) - 6}" text-anchor="end" font-size="10.5" fill="${C.dim}">${hl.label}</text>`
  for (const se of series) {
    for (let i = 1; i < se.pts.length; i++) {
      const [a0, b0] = se.pts[i - 1], [a1, b1] = se.pts[i]
      const broken = zeroRow && (b0 <= 0 || b1 <= 0) // segment crosses the axis break into the 'fails' row
      s += `<line x1="${X(a0)}" y1="${Y(b0)}" x2="${X(a1)}" y2="${Y(b1)}" stroke="${se.color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${broken ? '2 5' : ''}" opacity="${broken ? 0.7 : 1}"></line>`
    }
    for (const [a, b, tip] of se.pts) s += `<g><title>${se.name}: ${tip ?? `${a} → ${b}`}</title><circle cx="${X(a)}" cy="${Y(b)}" r="9" fill="transparent"></circle><circle cx="${X(a)}" cy="${Y(b)}" r="${se.hollow ? 5.5 : 4.5}" fill="${se.hollow ? C.panel : se.color}" stroke="${se.hollow ? se.color : C.panel}" stroke-width="2"></circle></g>`
    if (se.endLabel) {
      const [a, b] = se.pts[se.endLabel.at ?? se.pts.length - 1]
      s += `<text x="${X(a) + (se.endLabel.dx ?? 8)}" y="${Y(b) + (se.endLabel.dy ?? 4)}" font-size="11" fill="${C.ink}">${se.endLabel.text}</text>`
    }
  }
  return s + '</svg>'
}
function sup(n) { return String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d] ?? d).join('') }

// ── horizontal bars ───────────────────────────────────────────────────────────────────────────────
function hbars({ w = 568, rows, max, log = false, min = 1, unit = '', valueFmt = (v) => `${v}` }) {
  const rowH = 30, lw = 210, rr = 70
  const h = rows.length * rowH + 8
  const L = (v) => (log ? (Math.log10(Math.max(v, min)) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : v / max) * (w - lw - rr)
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" style="display: block; max-width: 100%;">`
  rows.forEach((r, i) => {
    const y = 4 + i * rowH
    const bw = Math.max(2, L(r.v))
    s += `<text x="${lw - 12}" y="${y + 19}" text-anchor="end" font-size="12" fill="${C.dim}" style="font-family: ${SANS};">${r.label}</text>`
    s += `<g><title>${r.label}: ${valueFmt(r.v)}${unit}</title><rect x="${lw}" y="${y + 6}" width="${bw}" height="18" rx="3" fill="${r.color}"></rect></g>`
    s += `<text x="${lw + bw + 8}" y="${y + 19}" font-size="12" fill="${C.ink}">${valueFmt(r.v)}${unit}</text>`
  })
  return s + '</svg>'
}

// ════════════════════════════════════ artboards ═══════════════════════════════════════════════════
const files = {}

// 1. Overview
const tile = (n, text, kind, kindText) => `<div style="background: ${C.panel}; border: 1px solid ${C.line}; border-radius: 8px; padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; min-height: 150px;">
  <div style="font: 500 38px/1 ${MONO}; letter-spacing: -0.02em; color: ${C.ink};">${n}</div>
  <p style="font-size: 14px; line-height: 1.45; color: ${C.dim}; text-wrap: pretty; flex-grow: 1;">${text}</p>
  <div>${badge(kind, kindText)}</div>
</div>`
const findings = [
  ['measured', 'measured', 'No localized state is a fixed point of the linear cavity. In the self-imaging SLM ring 2–3 px dots keep their shape ~2×10³ round trips (1.6 µs), then dephase — with near-perfect revivals at 2.3×10⁴ trips.'],
  ['measured', 'measured', 'Capacity is set by relay étendue, not pixels: 85 of 4096 modes live beyond 10⁵ trips, and only the central ±200 µm of the 1.28 mm field is unvignetted.'],
  ['measured', 'measured', 'Transient bit lattices at 650 nm: 278 bits/mm² for 128 trips, 39 bits/mm² for 1024. Lifetime grows as pitch², so density × lifetime ≈ 4×10⁴ bit·trips/mm²; below 3 px pitch decoding fails at once (at 450 nm a 2 px lattice lasts 64 trips).'],
  ['fail', 'failed', 'Gain compensates loss, not dephasing. A bistable gain + absorber medium with phase-only masks never held a bit pattern: the ON state invades or dies.'],
  ['fail', 'failed', 'Masks designed by gradient descent and re-checked in the simulator learned timed transients: the first design held exactly through its 150-trip training horizon, then the field lased over it; the fixed-point-constrained redesign never exceeded 87 % and was fully wrong by trip 301.'],
  ['measured', 'measured', 'A static absorbing amplitude mask (cells clear, gaps dark) plus saturable gain and absorber gives stable bistable bits: 9/9 cells, 0 errors to 10⁵ trips (67 µs), perturbations decaying (λ < 0); 3/3 seeds also hold at 1000:1 contrast and with gain noise up to 10⁻³ per trip. Gain window G0 ≈ 2.8–3.4. A gradient-designed absorbing memory held all 8 random patterns to 10⁴ trips; at 100 µm pitch only 3 of 8.'],
  ['measured', 'measured', 'Static linear wires move a bit 80–480 µm with 1–3 trips of latency per pixel, but hold only when the destination is the cavity’s dominant eigenmode — one attractor per cavity.'],
  ['fail', 'mostly failed', 'Universal persistent logic was not achieved. Linear gates are transient (XOR fails at trip 130). With the absorbing mask only AND became persistent (4/4, settles by trip 184); OR, XOR, NAND, NOT and a set/reset latch failed — the isolation that makes bits permanent stops one input switching an output, and power rails flood neighbours.'],
  ['measured', 'measured', 'Static optics are a clock: the −I ring toggles every trip and one SLM lens turns the relay into 5-, 7- or 12-state cycles. All fail at 0.5–3×10³ trips — from dephasing, not noise. A designed linear 4-cell ring counter stepped correctly for ~16 ticks; designed nonlinear toggles and rings failed.'],
  ['measured', 'measured', 'The best reservoir is the “messy” non-imaging relay: memory capacity 35 (37-step horizon), NARMA10 NMSE 0.19, against 7 and 0.66 for a 256-unit ESN. The self-imaging ring scores 2–5.'],
  ['measured', 'measured', 'Extra recurrence between sensor frames hurts control: of K = 1, 10, …, 10⁵ trips per frame, tracking is best at 10 (error 0.87 ± 0.49, on par with an ESN at 0.98 ± 0.68); at 10⁴ trips per frame the policy loses the target, and the self-imaging ring at best matches a memoryless readout.'],
  ['measured', 'measured', 'Cheap LCD + microlens optics lose capability, not just efficiency (≤ 5 modes past 10³ trips, no lattice past 32). Blue light gives ~2.8× the long-lived modes and ~2× the lifetimes — never a qualitative change.'],
]
files['Main.dc.html'] = page(frame('What a static optical program can hold, move and compute', 'PHASER capability sprint · research findings · 2026-09-14', `
  <p style="font-size: 17px; line-height: 1.55; color: ${C.dim}; max-width: 980px; text-wrap: pretty;">Twenty planned experiments on the headless PHASER simulator, reported here as far as they have run, with the optical program held fixed for 10⁴–10⁶ round trips. Numbers are measured in the simulator unless badged otherwise; long horizons use exact matrix powers checked against direct simulation to 10⁻¹¹ at 10⁵ trips.</p>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;">
    ${tile('0', 'persistent bit patterns from any phase-only static program, hand-built or gradient-designed', 'fail', 'failed')}
    ${tile('10⁵', 'round trips with zero bit errors — bistable cells behind a static absorbing mask; also holds at 1000:1 contrast and with gain noise', 'measured', 'measured')}
    ${tile('2–4×10³', 'round trips: the dephasing ceiling on every linear state, lattice and clock', 'validated', 'exact to 10⁶ · checked 10⁵')}
    ${tile('10', 'optical trips per sensor frame was the best of K = 1…10⁵ for control; 10⁴ destroys the policy', 'measured', 'measured')}
  </div>
  <div style="display: flex; flex-direction: column; gap: 0;">
    ${label('Twelve findings', 'margin-bottom: 6px;')}
    ${findings.map(([k, kt, text], i) => `<div style="display: grid; grid-template-columns: 44px minmax(0, 1fr) 96px; gap: 16px; align-items: baseline; padding: 13px 0; border-bottom: 1px solid ${C.line};">
      <div style="font: 500 13px/1 ${MONO}; color: ${C.faint};">${String(i + 1).padStart(2, '0')}</div>
      <p style="font-size: 15px; line-height: 1.5; color: ${C.ink}; text-wrap: pretty;">${text}</p>
      <div style="text-align: right;">${badge(k, kt)}</div>
    </div>`).join('')}
  </div>
  <p style="font: 12px/1.5 ${MONO}; color: ${C.faint};">Still running when this page was made (Exps 7, 10–12, 16): adders, parity and saturating step, countdown, associative memory, absorbing-mask sequencers, a persistent wire and OR with a rail. Full write-up: research/2026-09-14/REPORT.md</p>
`, 1720))

// 2. Capability envelope
const envRows = [
  ['Minimum persistent state', '3 px cell (60 µm) with 3 px absorbing gaps', 'Self-imaging SLM ring + absorbing LCD, G0 3; ideal or 1000:1 contrast, gain noise ≤ 10⁻³', ['measured', 'to 10⁵ trips']],
  ['Persistent states / mm²', '69 (120 µm pitch); a designed program held 8/8 random patterns to 10⁴ trips', 'same', ['measured', 'measured']],
  ['Linear states surviving 100 trips / mm²', '278 (60 µm pitch)', 'Self-imaging ring, flat field, 650 nm', ['measured', 'measured']],
  ['Linear states surviving 10³ trips / mm²', '39 at 650 nm · 69 at 450 nm', 'same', ['measured', 'measured']],
  ['Linear states surviving 10⁴ trips', 'none — dephasing ceiling ≈ 2–4×10³ trips', 'any linear configuration', ['validated', 'exact to 10⁶ · checked 10⁵']],
  ['Long-lived effective modes (τ > 10⁵ trips, relative to the gain-clamped dominant mode)', '344 (B, 450 nm, lens-sampling caveat) · 235 (A, 450 nm) · 155 (B, 650 nm) · 85 (A, 650 nm)', 'exact eigen-spectra of 4096×4096 operators', ['measured', 'exact']],
  ['Autonomous state progression', '2-state toggle to 3162 trips; 12-state cycle to ~500; designed 4-cell one-hot ring ~16 ticks', 'preset relay + one static SLM lens; −I ring; designed linear program', ['measured', 'measured']],
  ['Wire', '160 µm, holds to 10⁴ trips; 1–3 trips latency per pixel', 'defocused self-imaging ring, linear, single wire', ['measured', 'measured']],
  ['Persistent gates', 'AND 4/4 cases to 10⁴ trips (settles by trip 184); OR, XOR, NAND, NOT failed; linear XOR transient', 'absorbing-mask architecture', ['measured', 'measured']],
  ['Set / reset latch', 'hold works in both states; set takes ~180 trips; reset not achieved', 'absorbing-mask architecture, rail', ['fail', 'failed']],
  ['Autonomous logic depth', '0 — no functionally complete persistent gate set', '—', ['fail', 'not achieved']],
  ['Machine instructions executed', '0 — not attempted: no complete gate set and no resettable register', '—', ['pending', 'not attempted']],
  ['Reservoir memory horizon', '37 input steps (370 trips, ≈ 250 ns); capacity 34.6', 'preset relay, linear, K = 10', ['measured', 'measured']],
  ['Control update performance', 'tracking error 0.87 ± 0.49 at 150 MHz frames (ESN 0.98 ± 0.68, memoryless 1.57)', 'preset relay, K = 10', ['measured', 'measured']],
  ['Round-trip rate', '0.37 GHz (B) · 1.50 GHz (A) · 3.67 GHz (C)', 'Σ n_g L / c over the route', ['validated', 'analytical']],
]
const protoRows = [
  ['Persistent bits', '~9–16 in this relay’s flat field; ~70 per mm² of unvignetted field with a wider relay', ['extrap', 'extrapolated']],
  ['Transient latent dimensions', '~44 lattice states or ~200 modes living > 100 trips', ['extrap', 'inferred']],
  ['Internal recurrence frequency', '1.5 GHz (0.67 ns per trip)', ['validated', 'analytical']],
  ['Useful algorithmic update rate', '10–100 trips per step → 15–150 MHz', ['extrap', 'inferred']],
  ['Sensor input bandwidth', 'one frame per ~10 trips (150 MHz) optically; mask updates ~200 Hz from the preset LCOS switching time (5 ms)', ['extrap', 'inferred']],
  ['Action output', '256 detector bins read linearly once per frame; physical detector and readout rate not modeled', ['pending', 'speculative']],
]
files['Envelope.dc.html'] = page(frame('Capability envelope', 'Experiment 20 · consolidated', `
  ${panel(`<table>
    <tr><th style="width: 26%;">Property</th><th style="width: 33%;">Best measured result</th><th style="width: 27%;">Configuration</th><th>Evidence</th></tr>
    ${envRows.map(([p, v, c, [k, kt]]) => `<tr><td style="color: ${C.dim};">${p}</td><td style="color: ${C.ink};">${v}</td><td style="color: ${C.dim};">${c}</td><td>${badge(k, kt)}</td></tr>`).join('')}
  </table>`)}
  ${label('A first physical prototype — estimates, not measurements')}
  ${panel(`<table>
    <tr><th style="width: 26%;">Quantity</th><th style="width: 60%;">Estimate</th><th>Basis</th></tr>
    ${protoRows.map(([p, v, [k, kt]]) => `<tr><td style="color: ${C.dim};">${p}</td><td style="color: ${C.ink};">${v}</td><td>${badge(k, kt)}</td></tr>`).join('')}
  </table>`)}
`, 1720))

// 3. Storage (Exp 1–3)
const dotChart = logChart({
  x: [3, 150], y: [1, 10000], xTicks: [3, 10, 30, 100], yTicks: [1, 10, 100, 1000, 10000],
  xLabel: 'initial dot width σ (µm, intensity rms)', yLabel: 'round trips until correlation < 0.9',
  vlines: [{ x: 20, label: 'A pixel' }, { x: 63.5, label: 'B pixel' }],
  series: [
    { name: 'A self-imaging SLM ring', color: C.blue, pts: [[3, 1], [5, 1], [7, 1], [10, 2], [14, 316], [20, 422], [28, 750], [40, 1778], [57, 2371], [80, 2371]].map(([a, b]) => [a, b, `σ ${a} µm → ${b} trips`]), endLabel: { text: 'A', dx: 8, dy: -6 } },
    { name: 'B linear 4f LCD', color: C.orange, pts: [[16, 100], [32, 237], [64, 1334], [128, 1000]].map(([a, b]) => [a, b, `σ ${a} µm → ${b} trips`]), endLabel: { text: 'B', dx: 8, dy: 4 } },
    { name: 'C LCD + microlens', color: C.aqua, pts: [[32, 24], [64, 1], [96, 1], [128, 1]].map(([a, b]) => [a, b, `σ ${a} µm → ${b} trips`]), endLabel: { text: 'C', dx: 8, dy: -6 } },
  ],
})
const dens = (p) => 1e6 / (p * p)
const frontierChart = logChart({
  x: [6, 2600], y: [16, 4096], xTicks: [10, 30, 100, 300, 1000], yTicks: [16, 64, 256, 1024, 4096], zeroRow: 'fails at 1',
  xLabel: 'logical states per mm² (one bit per cell)', yLabel: 'round trips with zero bit errors',
  guides: [{ pts: [[10, 4000], [2500, 16]], label: 'density × lifetime ≈ 4×10⁴', at: [7, 2500] }],
  series: [
    { name: 'A ring, 650 nm', color: C.blue, pts: [[20, 0], [40, 0], [60, 128], [80, 256], [100, 512], [120, 512], [160, 1024], [200, 1024]].map(([p, l]) => [dens(p), l, `${p} µm pitch (${Math.round(dens(p))}/mm²) → ${l ? l + ' trips' : 'fails at t = 1'}`]) },
    { name: 'A ring, 450 nm', color: C.orange, hollow: true, pts: [[20, 0], [40, 64], [60, 256], [80, 256], [100, 512], [120, 1024], [160, 1024], [200, 1024]].map(([p, l]) => [dens(p), l, `${p} µm pitch (${Math.round(dens(p))}/mm²) → ${l ? l + ' trips' : 'fails at t = 1'}`]) },
    { name: 'B linear 4f, 650 nm', color: C.aqua, pts: [[64, 0], [95, 64], [127, 128], [159, 256], [190, 256], [254, 512], [317, 512], [381, 512]].map(([p, l]) => [dens(p), l, `${p} µm pitch (${Math.round(dens(p))}/mm²) → ${l ? l + ' trips' : 'fails at t = 1'}`]) },
  ],
})
const note = (t, body) => `<div style="display: flex; flex-direction: column; gap: 8px;"><h3 style="font: 600 15px/1.3 ${SANS}; color: ${C.ink};">${t}</h3><p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">${body}</p></div>`
files['Storage.dc.html'] = page(frame('Storage: long-lived, but never permanent, in linear optics', 'Experiments 1–3 · dots, packing, transient frontier', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Single-dot lifetime vs width')}${legend([{ name: 'A self-imaging SLM ring', color: C.blue }, { name: 'B linear 4f LCD', color: C.orange }, { name: 'C LCD + microlens', color: C.aqua }])}${dotChart}<p style="font-size: 13px; color: ${C.faint};">Dots with σ ≤ 10 µm (half a pixel) lose their shape in 1–2 trips (relay NA). σ = 57 µm lasts 2371 trips = 1.6 µs.</p>`)}
    ${panel(`${label('Transient frontier · flat field of view')}${legend([{ name: 'A ring, 650 nm', color: C.blue }, { name: 'A ring, 450 nm (hollow; overlaps 650 nm at 4 pitches)', color: C.orange, hollow: true }, { name: 'B linear 4f, 650 nm', color: C.aqua }])}${frontierChart}<p style="font-size: 13px; color: ${C.faint};">Phase 0/π encoding, 24 random patterns per lattice, exact matrix powers to 10⁶ trips.</p>`)}
  </div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px;">
    ${note('Dephasing, not loss', 'Gain holds the energy, but the long-lived modes are global Laguerre–Gauss modes whose phases drift apart by ~5×10⁻⁴ rad per order each trip. A dot’s shape dissolves and then revives (corr 0.99 at 2.3×10⁴ trips).')}
    ${note('Vignetting sets the field', 'The 1.2 mm relay lenses cut per-cell retention to 0.09 in the corners of a ±400 µm lattice after one trip. Only ±200 µm (0.16 mm², 20×20 SLM pixels) behaves; with it excluded, every encoding decodes the same.')}
    ${note('No permanent linear state', 'Every encoding at every pitch fails by 2–4×10³ trips. Mask disorder (the preset random SLM program) cuts lattice lifetimes 8× and dot lifetimes up to 100×; a 1 % relay focus error cuts dot lifetimes 40×.')}
  </div>
`, 1180))

// 4. Modes & coupling (Exp 4–5)
const modeRows = [
  ['B linear 4f LCD', 344, 310, 155], ['A self-imaging SLM ring', 200, 173, 85], ['A preset relay', 111, 20, 1], ['A self-imaging + random SLM program', 143, 4, 1], ['B lensless (shipped preset style)', 29, 1, 1], ['C LCD + microlens', 29, 5, 1],
]
const ramp = ['#86b6ef', '#3987e5', '#1c5cab']
const modeBars = (() => {
  const w = 568, lw = 230, rr = 44, rowH = 58, h = modeRows.length * rowH + 30
  const max = 400
  const L = (v) => (Math.log10(Math.max(v, 1)) / Math.log10(max)) * (w - lw - rr)
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" style="display: block; max-width: 100%;">`
  for (const t of [1, 10, 100]) s += `<line x1="${lw + L(t)}" x2="${lw + L(t)}" y1="0" y2="${h - 22}" stroke="${C.line}"></line><text x="${lw + L(t)}" y="${h - 6}" text-anchor="middle" font-size="11" fill="${C.faint}">${t}</text>`
  modeRows.forEach(([name, a, b, c], i) => {
    const y = i * rowH + 4
    s += `<text x="${lw - 12}" y="${y + 29}" text-anchor="end" font-size="12" fill="${C.dim}" style="font-family: ${SANS};">${name}</text>`
    ;[[a, '> 10² trips'], [b, '> 10³ trips'], [c, '> 10⁵ trips']].forEach(([v, lab], k) => {
      const bw = Math.max(2, L(v))
      s += `<g><title>${name}: ${v} modes ${lab}</title><rect x="${lw}" y="${y + 4 + k * 16}" width="${bw}" height="14" rx="3" fill="${ramp[k]}"></rect></g><text x="${lw + bw + 6}" y="${y + 15 + k * 16}" font-size="10.5" fill="${C.ink}">${v}</text>`
    })
  })
  return s + '</svg>'
})()
const coupling = [
  ['A self-imaging ring (81 cells, 100 µm pitch)', '103 µm', '106 µm', '453 µm', '81 → 77 → 69'],
  ['B linear 4f LCD (64 cells, 190 µm pitch)', '197 µm', '200 µm', '248 µm', '64 → 64 → 36'],
  ['C LCD + microlens (49 cells, 254 µm pitch)', '266 µm', '777 µm', '624 µm', '49 → 49 → 3'],
]
files['Modes.dc.html'] = page(frame('Few modes, all global — and locality that lasts ~10³ trips', 'Experiments 4–5 · coupling matrices and eigen-spectra', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Modes living longer than… (gain clamped on the dominant mode)')}${legend([{ name: '> 10² trips', color: ramp[0] }, { name: '> 10³ trips', color: ramp[1] }, { name: '> 10⁵ trips', color: ramp[2] }])}${modeBars}<p style="font-size: 13px; color: ${C.faint};">Log scale. Exact eigen-decomposition of 4096×4096 round-trip operators. No mode lives more than 10 trips without gain.</p>`)}
    <div style="display: flex; flex-direction: column; gap: 24px;">
      ${panel(`${label('Cell-to-cell coupling over time')}<table>
        <tr><th>Configuration</th><th>radius t=1</th><th>t=128</th><th>t=16384</th><th>rank 1→128→16384</th></tr>
        ${coupling.map((r) => `<tr><td style="color: ${C.dim};">${r[0]}</td>${r.slice(1).map((v) => `<td class="num">${v}</td>`).join('')}</tr>`).join('')}
      </table>`)}
      ${note('Modes are global, dots are superpositions', 'The longest-lived eigenmodes of the self-imaging ring are centred Laguerre–Gauss patterns, degenerate in magnitude to 10⁻¹¹. 85 of them share the same 0.3 mm² — many concurrent latent components, but as modes, not pixels.')}
      ${note('Étendue is the bottleneck', 'Mode counts match the relay étendue (field ≈ 0.3 mm radius × NA ≈ 5 mrad), not the 4096 SLM pixels. Coupling stays nearest-neighbour to ~10³ trips in A (115 µm radius at 1024) and ≥ 128 in B, then becomes long-range as light dephases.')}
    </div>
  </div>
`, 1000))

// 5. Dynamics & clocks (Exp 6, 10)
const regime = [['near-critical, pattern lost', 55], ['saturated, lasing everywhere', 35], ['extinct', 24], ['chaotic / expanding', 18], ['long-memory stable', 0]]
const clockChart = (() => {
  const pts0 = [[2, 3162], [5, 1778], [7, 1000], [12, 504]]
  const pts3 = [[2, 3162], [5, 3162], [7, 1000], [12, 492]]
  return logChart({
    x: [1.6, 15], y: [300, 5000], xTicks: [2, 5, 7, 12], yTicks: [300, 1000, 3000], xLabel: 'states per cycle (q)', yLabel: 'trips to first sequence error',
    series: [
      { name: 'no noise', color: C.blue, pts: pts0.map(([q, e]) => [q, e, `q = ${q}: first error at ${e} trips`]) },
      { name: 'noise 10⁻³ per trip', color: C.orange, hollow: true, pts: pts3.map(([q, e]) => [q, e, `q = ${q}, noise 1e-3: first error at ${e} trips`]) },
    ],
  })
})()
files['Dynamics.dc.html'] = page(frame('Regimes and clocks: static optics cycle through states for ~10³ trips', 'Experiments 6 and 10 · edge of stability, autonomous state progression', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('132 operating points (gain × absorber × mask)')}${hbars({ rows: regime.map(([l, v]) => ({ label: l, v, color: v === 0 ? C.line2 : C.dim })), max: 60, valueFmt: (v) => `${v}` })}<p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">A per-sample analysis predicts bistability at 66 of these points; none holds a written pattern. The relay spills a few percent of each ON cell into its neighbours every trip, while the absorber switches at ~5 % of the ON level.</p>`)}
    ${panel(`${label('Re-entrant cavities as clocks')}${legend([{ name: 'no noise', color: C.blue }, { name: 'noise 10⁻³ per trip (hollow; overlaps at q = 2, 7)', color: C.orange, hollow: true }])}${clockChart}<p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">q = 2: the −I ring alone. q = 5, 7, 12: preset relay plus one static SLM lens (+6.6, −2.6, +0.9 D). q = 4 and 8 would need 87 and 158 D lenses — beyond what 20 µm pixels can render.</p>`)}
  </div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px;">
    ${note('A clock with no electronics', 'Every re-entrant program cycled its states in order at 1.5 GHz, one state per round trip, with the mask never touched. A designed linear 4-cell ring counter stepped its one-hot token for ~16 ticks (160 trips) before collapsing; designed nonlinear toggles and rings failed.')}
    ${note('Limited by optics, not noise', 'Noise up to 10⁻³ of the state power per trip never made the first error earlier. The same mode-phase spread that ends storage ends the clock.')}
    ${note('Longer cycles are blurrier', 'The 12-state cycle starts with a best/second overlap ratio of only ~2: its intermediate states are rotated versions of one field, not localized cells.')}
  </div>
`, 1000))

// 6. Memory & logic (Exp 2nl, 7–9, 11–14)
const route = (title, verdict, kind, body, stat) => panel(`<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">${badge(kind, verdict)}<h3 style="font: 600 16px/1.3 ${SANS}; color: ${C.ink};">${title}</h3></div><div style="font: 500 21px/1.15 ${MONO}; color: ${C.ink};">${stat}</div><p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">${body}</p>`)
const windowStrip = (() => {
  const cells = [['2.2', 0, 'bad'], ['2.4', 0, 'bad'], ['2.6', 0, 'bad'], ['2.8', 1, 'warn'], ['3.0', 3, 'ok'], ['3.2', 3, 'ok'], ['3.4', 3, 'ok'], ['4.0', 2, 'warn'], ['5.0', 0, 'bad']]
  const note2 = { '2.2': 'all cells die', '2.4': 'all cells die', '2.6': 'all cells die', '2.8': '1 of 3 seeds holds', '3.0': '3 of 3', '3.2': '3 of 3', '3.4': '3 of 3 (1000:1)', '4.0': '2 of 3', '5.0': 'every cell ON' }
  return `<div style="display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 6px;">${cells.map(([g, n, st]) => `<div title="G0 ${g}: ${note2[g]}" style="border: 1px solid ${st === 'ok' ? '#2a4a33' : st === 'warn' ? '#4d3f22' : '#4a2222'}; border-radius: 6px; padding: 10px 8px; display: flex; flex-direction: column; gap: 6px; background: ${C.panel};">
    <div style="font: 500 14px/1 ${MONO}; color: ${C.ink};">G0 ${g}</div>
    <div style="display: flex; align-items: center; gap: 6px;"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${st === 'ok' ? `<path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="${C.ok}" stroke-width="1.6"></path>` : st === 'warn' ? `<path d="M6 2v5M6 9.5v.5" stroke="${C.warn}" stroke-width="1.6" stroke-linecap="round"></path>` : `<path d="M3 3l6 6M9 3l-6 6" stroke="${C.bad}" stroke-width="1.6" stroke-linecap="round"></path>`}</svg><span style="font: 12px/1 ${MONO}; color: ${C.ink};">${n}/3 seeds</span></div>
    <div style="font-size: 11.5px; line-height: 1.3; color: ${C.faint};">${note2[g]}</div>
  </div>`).join('')}</div>`
})()
const wires = [['80 µm (4 px)', '4', '0.21', 'held to 550 trips'], ['160 µm (8 px), 60-trip training', '20', '0.09', 'held to 70 trips'], ['160 µm (8 px), 150-trip training', '19', '0.44', 'holds to 10⁴ (eigenmode sink)'], ['320 µm (16 px)', '46', '0.16', 'held to 175 trips'], ['480 µm (24 px)', '—', '—', 'held to 273 trips'], ['160 µm with 2 spectator bits', '—', '—', '2 of 6 cases hold to 10⁴']]
const gates = [['8-bit parity (checked on all 256 inputs)', '11 XOR', '3'], ['Saturating controller step, 8-bit (all 65 536)', '66', '24'], ['One subtraction-gcd iteration, 8-bit (6304 pairs)', '202', '31'], ['Accumulator machine step, 4-bit (structural estimate)', '316 + ≈224 ROM', '20']]
files['Logic.dc.html'] = page(frame('Memory and logic: persistent bits yes, universal persistent logic no', 'Experiments 2 (nonlinear), 7–9, 11–14', `
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;">
    ${route('Hand-built phase moat', 'failed', 'fail', 'A π-checkerboard around each cell was meant to scatter gap light away. OFF cells ended brighter than ON cells, or every cell died.', 'BER 0.3–0.6')}
    ${route('Gradient-designed phase mask', 'failed', 'fail', 'Designed through a differentiable replica (matches the simulator to 10⁻¹⁴), then re-run in the simulator. It learned a slowly lasing field timed to invade just after the 150-trip horizon.', 'held 150 trips')}
    ${route('Static absorbing amplitude mask', 'measured · 10⁵ trips', 'measured', 'Cells clear, 3 px gaps dark, saturable gain + absorber. Gaps cannot lase, so fronts cannot move; each cell settles into a stable fixed point (λ ≈ −10⁻³ per trip). Also 3/3 seeds at 1000:1 contrast and with gain noise up to 10⁻³.', '0 errors · 10⁵ trips')}
  </div>
  ${panel(`${label('Operating window · 3 px cells, 120 µm pitch, 3 seeds, 3000 trips')}${windowStrip}<p style="font-size: 13px; color: ${C.faint};">G0 3.0 was also run to 10⁵ trips (0 errors), at 1000:1 contrast and with gain noise 10⁻⁴ and 10⁻³ (0 errors to 10⁴). G0 3.4 is from the 1000:1 scan; 4.0–5.0 from the first coarse sweep; 3.6–3.8 not run. 2 px cells failed at every gain.</p>`)}
  ${panel(`${label('Gates and latch on the absorbing-mask architecture · re-run in the simulator to 10⁴ trips')}<table>
      <tr><th>Circuit</th><th>cases correct at steady state</th><th>persistent</th><th>inputs kept</th><th>failure mode</th></tr>
      ${[['AND', '4 / 4', 'yes · settles by trip 184', 'yes', '—', 'measured'], ['OR', '1 / 4', '—', 'yes', 'one input never switches the output', 'fail'], ['XOR (rail)', '2 / 4', '—', 'yes', 'output stuck OFF', 'fail'], ['NAND (rail)', '3 / 4', '—', 'no — rail light erased an input', 'output stuck ON', 'fail'], ['NOT (rail)', '1 / 2', '—', 'yes', 'output stuck OFF', 'fail'], ['Set / reset latch', 'hold 0 and 1; set slow', 'hold yes', 'yes', 'reset never clears Q', 'fail']].map((r) => `<tr><td style="color: ${C.ink};">${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td style="color: ${C.dim};">${r[4]}</td></tr>`).join('')}
    </table><p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">Every design latched its inputs — memory carries over. The output only responds through a bistable threshold: isolation strong enough to make a bit permanent means one ON source cannot switch a cell, and a rail strong enough to invert floods its neighbours. Only a coincidence function (AND) fits; AND alone is not functionally complete. Resetting a cell needs destructive interference with a phase the gain medium does not fix, or an inhibitory nonlinearity the element set lacks.</p>`)}
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Static linear wires · defocused self-imaging ring')}<table>
      <tr><th>Distance</th><th>latency (trips)</th><th>efficiency</th><th>outcome</th></tr>
      ${wires.map((r) => `<tr><td style="color: ${C.dim};">${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td>${r[3]}</td></tr>`).join('')}
    </table><p style="font-size: 13px; color: ${C.faint};">Linear XOR: correct for 00, 01, 10 to 10⁴ trips; 11 fails at trip 130 when both inputs relax into the dominant mode.</p>`)}
    ${panel(`${label('What a machine would need · gate-level netlists')}<table>
      <tr><th>Circuit</th><th>2-input gates</th><th>depth</th></tr>
      ${gates.map((r) => `<tr><td style="color: ${C.dim};">${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}
    </table><p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">Only AND has been shown persistent — not a complete gate set — and no register can be reset, so no instruction was executed: the stop condition. At ~3 cells of 0.0144 mm² per gate, one accumulator step (gates only, excluding ROM and routing) is ~14 mm² of flat, unvignetted field; this relay offers 0.16 mm². ${badge('extrap', 'extrapolated')}</p>`)}
  </div>
  <p style="font: 12px/1.5 ${MONO}; color: ${C.faint};">Running: half/full adder, parity, saturating step, countdown and associative memory on the absorbing-mask architecture; absorbing-mask toggle and ring counter; a persistent wire and OR with a rail (the missing single-input coupling).</p>
`, 1760))

// 7. Temporal (Exp 15, 17)
const mcRows = [
  { label: 'preset relay, linear', v: 34.6, color: C.blue }, { label: 'B 4f LCD + gain (G0 1.8)', v: 15.9, color: C.blue }, { label: 'preset relay + gain/absorber', v: 10.8, color: C.blue },
  { label: 'ESN, 256 tanh units', v: 7.1, color: C.dim }, { label: '8-tap delay line', v: 7.0, color: C.dim },
  { label: 'preset relay + Kerr', v: 5.2, color: C.blue }, { label: 'self-imaging ring', v: 4.7, color: C.blue }, { label: 'C LCD + microlens', v: 2.8, color: C.blue }, { label: 'preset relay near lasing', v: 0.4, color: C.blue },
]
const ctlChart = logChart({
  x: [0.7, 150000], y: [0.1, 40], xTicks: [1, 10, 100, 1000, 10000, 100000], yTicks: [0.1, 0.3, 1, 3, 10, 30],
  xLabel: 'optical round trips per sensor frame (K)', yLabel: 'closed-loop tracking error',
  hlines: [{ y: 1.57, label: 'memoryless readout 1.57' }, { y: 0.98, label: 'ESN 0.98' }, { y: 0.146, label: 'oracle 0.15' }],
  series: [
    { name: 'preset relay, gain 0.995/trip', color: C.blue, pts: [[1, 3.93], [10, 0.87], [100, 2.17], [1000, 4.36], [10000, 21.0], [100000, 21.0]].map(([k, e]) => [k, e, `K = ${k}: error ${e}`]) },
    { name: 'preset relay, gain 0.9/trip', color: C.orange, pts: [[1, 4.21], [10, 1.49], [100, 20.1]].map(([k, e]) => [k, e, `K = ${k}: error ${e}`]) },
    { name: 'self-imaging ring', color: C.aqua, pts: [[1, 10.4], [10, 20.1], [100, 1.54], [1000, 1.54]].map(([k, e]) => [k, e, `K = ${k}: error ${e}`]) },
  ],
})
files['Temporal.dc.html'] = page(frame('Temporal processing: the non-imaging preset relay wins, extra recurrence hurts', 'Experiments 15 and 17 · reservoir baseline, streaming control', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Reservoir memory capacity · one input per 10 trips')}${legend([{ name: 'optical (fixed masks, digital linear readout)', color: C.blue }, { name: 'digital baseline', color: C.dim }])}${hbars({ rows: mcRows, max: 40, valueFmt: (v) => v.toFixed(1) })}<p style="font-size: 13px; color: ${C.faint};">Σ r² of delayed-input recall. NARMA10 NMSE: preset relay 0.19, ESN 0.66. Detection is square-law, so delayed XOR is solved with no medium nonlinearity.</p>`)}
    ${panel(`${label('Streaming control · target tracking with occlusions')}${legend([{ name: 'preset relay, gain 0.995/trip', color: C.blue }, { name: 'preset relay, gain 0.9/trip', color: C.orange }, { name: 'self-imaging ring', color: C.aqua }, { name: 'digital references', color: C.dim, dash: '5 4' }])}${ctlChart}<p style="font-size: 13px; color: ${C.faint};">The optical state is never reset; masks fixed for the episode; linear readout trained by behaviour cloning and evaluated closed loop.</p>`)}
  </div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px;">
    ${note('Storage and memory conflict', 'Self-imaging maximises how long a state lives but makes every past input land on the same pixels with the same phase — a readout cannot tell delays apart. Temporal memory needs distinct mode phases.')}
    ${note('Recurrence is a low-pass filter', 'Between frames the static cavity applies M^K. Past the mode lifetimes (~10–100 trips here) that collapses every frame onto a few modes; at 10⁴ trips per frame the controller outputs a constant. The self-imaging ring never beats the memoryless readout.')}
    ${note('Nonlinearity trades memory for expressivity', 'Adding gain saturation or Kerr solves 3-bit parity perfectly but cuts memory capacity from 35 to 5–11. Near lasing, memory vanishes.')}
  </div>
`, 1000))

// 8. Hardware, wavelength, implications, next (Exp 18–20)
const arch = [
  ['Round-trip rate', '1.50 GHz', '0.37 GHz', '3.67 GHz'],
  ['Required round-trip gain', '1.46', '1.59', '1.67'],
  ['Modes > 10³ / > 10⁵ trips', '173 / 85', '310 / 155', '5 / 1'],
  ['Best dot lifetime', '2371 trips, 1.6 µs', '1334 trips, 3.6 µs', '24 trips, 6.5 ns'],
  ['Densest lattice for 128 trips', '278 / mm²', '62 / mm²', 'none'],
  ['Reservoir capacity (K = 10)', '34.6 (preset relay)', '15.9 (with gain)', '2.8 (with gain)'],
]
const wlChart = (() => {
  const w = 568, h = 300, m = { l: 60, r: 70, t: 14, b: 48 }
  const X = (l) => m.l + ((l - 440) / (660 - 440)) * (w - m.l - m.r)
  const Y = (v) => m.t + (1 - v / 400) * (h - m.t - m.b)
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" style="display: block; max-width: 100%;">`
  for (const t of [0, 100, 200, 300, 400]) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.line}"></line><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${C.faint}">${t}</text>`
  for (const l of [450, 532, 650]) s += `<text x="${X(l)}" y="${h - m.b + 18}" text-anchor="middle" font-size="11" fill="${C.faint}">${l} nm</text>`
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 8}" text-anchor="middle" font-size="11" fill="${C.dim}">wavelength, geometry fixed</text><text transform="translate(14 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${C.dim}">modes living > 10⁵ trips</text>`
  const ser = [['B linear 4f', C.orange, [[450, 344], [532, 250], [650, 155]]], ['A self-imaging ring', C.blue, [[450, 235], [532, 156], [650, 85]]]]
  for (const [name, col, pts] of ser) {
    s += `<polyline points="${pts.map(([l, v]) => `${X(l)},${Y(v)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2"></polyline>`
    for (const [l, v] of pts) s += `<g><title>${name}, ${l} nm: ${v} modes</title><circle cx="${X(l)}" cy="${Y(v)}" r="9" fill="transparent"></circle><circle cx="${X(l)}" cy="${Y(v)}" r="4.5" fill="${col}" stroke="${C.panel}" stroke-width="2"></circle></g><text x="${X(l)}" y="${Y(v) - 10}" text-anchor="middle" font-size="10.5" fill="${C.ink}">${v}</text>`
    s += `<text x="${X(650) + 10}" y="${Y(pts[2][1]) + 4}" font-size="11" fill="${C.ink}">${name.split(' ')[0]}</text>`
  }
  return s + '</svg>'
})()
files['Hardware.dc.html'] = page(frame('Hardware: imaging quality, not loss, decides capability', 'Experiments 18–19 · architecture and wavelength', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Three modeled architectures')}<table>
      <tr><th></th><th>A reflective SLM ring</th><th>B linear 4f LCD</th><th>C LCD + microlens</th></tr>
      ${arch.map((r) => `<tr><td style="color: ${C.dim}; width: 30%;">${r[0]}</td>${r.slice(1).map((v) => `<td style="font-family: ${MONO}; font-size: 12.5px;">${v}</td>`).join('')}</tr>`).join('')}
    </table><p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">Required gain differs by only 1.46 → 1.67; mode count, lifetime and locality differ by 10–100×. The lensless LCD cavity of the shipped preset keeps one mode past 10³ trips.</p>`)}
    ${panel(`${label('Wavelength sensitivity')}${legend([{ name: 'A self-imaging ring', color: C.blue }, { name: 'B linear 4f LCD', color: C.orange }])}${wlChart}<p style="font-size: 14px; line-height: 1.55; color: ${C.dim}; text-wrap: pretty;">“Blue sharpens, red mixes” holds in direction: long-lived modes scale as λ⁻² to λ⁻²·⁸ (85 → 235 in A), the longest zero-error lifetime rises 1024 → 2048 trips (presence, 200 µm pitch) and 40 µm lattices become usable for 64 trips — about 2× in lifetime, 2.8× in mode count.</p>`)}
  </div>
`, 940))

const impl = [
  ['Encoding', 'Once vignetting is excluded, phase 0/π, dual-rail and presence decoded with a per-cell reference perform identically. Pick by readout hardware; avoid global-threshold presence.'],
  ['Topology', 'Self-imaging (A or B 4f) for storage; the non-degenerate relay for temporal processing — the same hardware with a different lens spacing or one static SLM lens.'],
  ['State scale', '3 px cells on a 6 px pitch (120 µm) for persistent bits; 3 px pitch (60 µm) for ~100-trip transient states. Pixels finer than the relay spot buy nothing.'],
  ['Digital logic', 'Persistent bits: yes, with an absorbing amplitude plane (10⁵ trips). Persistent logic: only AND worked; OR, XOR, NAND, NOT and a resettable latch did not. Not plausible with phase-insensitive local gain and absorbers alone.'],
  ['Spatial vs machine', 'Every symbolic result so far is spatial and transient. A clocked machine step is a ≥ 316-gate netlist of reliable gates plus 25 persistent state bits; direct spatial compilation of small functions is the only path with evidence.'],
  ['Reservoir and control', 'Stronger than symbolic computing today: matches or beats digital ESN baselines at 10 trips per input with no mask design at all.'],
  ['Useful horizons', '10–100 trips for temporal processing; ~10³ trips for linear state; ≥ 10⁵ trips (so far) only for absorbing-mask bistable cells.'],
  ['Parameter to improve first', 'For storage and temporal work: relay étendue and aberration phase spread. For logic: a nonlinearity that can inhibit or phase-lock a cell — the missing primitive.'],
]
const surprises = [
  'The self-imaging cavity that stores best is one of the worst reservoirs.',
  'More internal recurrence between sensor updates made control worse, monotonically past 10 trips per frame.',
  'Relay vignetting, not diffraction between neighbours, caused most bit errors in large lattices.',
  'Gradient-designed masks gamed their training horizon in the same way single-horizon mask scans gamed revival times.',
  'Persistence came from an absorbing amplitude program, not from any phase program.',
  'AND worked where OR failed: the isolation that makes a bit permanent makes a single input too weak to switch its neighbour.',
  'The simulator wraps pixel-scale scattered light around the FFT window unless propagation is split into ≤ 10 mm steps.',
]
const next = [
  'A cross-cell inhibitory or phase-sensitive nonlinearity (shared gain saturation between neighbouring cells, or a phase-locked parametric medium): does it make NOT, OR and latch reset possible alongside persistent AND?',
  'Aberration-corrected relay: add a Fourier-plane phase element to cancel the mode-phase spread and remeasure the dephasing ceiling.',
  'Wide-field relay: scale lens aperture and spacing to find how persistent-bit count grows with étendue.',
  'Noise and drift budget: gain noise, SLM phase flicker and focus drift against the absorbing-mask fixed point, to 10⁶ trips.',
  'Nonlinear closed-loop control: does a saturable medium let recurrence between frames help instead of hurt?',
]
files['Implications.dc.html'] = page(frame('Implications, surprises and the next five experiments', 'Synthesis', `
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
    ${panel(`${label('Architecture implications')}${impl.map(([k, v]) => `<div style="display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 14px; padding: 9px 0; border-top: 1px solid ${C.line};"><div style="font: 500 12px/1.4 ${MONO}; color: ${C.dim};">${k}</div><p style="font-size: 14px; line-height: 1.55; color: ${C.ink}; text-wrap: pretty;">${v}</p></div>`).join('')}`)}
    <div style="display: flex; flex-direction: column; gap: 24px;">
      ${panel(`${label('Results that contradicted intuition')}${surprises.map((s) => `<div style="display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; align-items: baseline;"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><rect x="1" y="1" width="6" height="6" fill="none" stroke="${C.faint}" stroke-width="1.4"></rect></svg><p style="font-size: 14px; line-height: 1.5; color: ${C.ink}; text-wrap: pretty;">${s}</p></div>`).join('')}`)}
      ${panel(`${label('Next five experiments')}${next.map((s, i) => `<div style="display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: baseline;"><div style="font: 500 13px/1 ${MONO}; color: ${C.faint};">${i + 1}</div><p style="font-size: 14px; line-height: 1.5; color: ${C.ink}; text-wrap: pretty;">${s}</p></div>`).join('')}`)}
    </div>
  </div>
  ${panel(`${label('How far to trust these numbers')}<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px;">
    ${[['Matrix extrapolation', 'M^t x₀ vs direct simulation: 9.5×10⁻¹² at 10⁵ trips. Two grids agree to 3 decimals.'], ['Design replica', 'Torch replica vs simulator: ≤ 1.6×10⁻¹³ over 6 trips (1.6×10⁻¹⁴ for the absorbing-mask replica); every design re-run in the simulator.'], ['Artefacts found', 'FFT wrap-around of scattered light (fixed with 10 mm steps); pixel dead zones never resolved.'], ['Not modeled', 'Thin paraxial lenses only, no pulse dynamics, no gain memory, noise-free unless stated.']].map(([t, b]) => `<div style="display: flex; flex-direction: column; gap: 6px;"><div style="font: 600 13px/1.3 ${SANS}; color: ${C.ink};">${t}</div><p style="font-size: 13px; line-height: 1.5; color: ${C.dim}; text-wrap: pretty;">${b}</p></div>`).join('')}
  </div>`)}
`, 1420))

for (const [f, src] of Object.entries(files)) writeFileSync(new URL(f, import.meta.url), src)

// canvas layout: 3 columns, generous row heights
const W = 1280, GX = 140, GY = 160
const layout = [
  ['Main.dc.html', 'Overview', 1720], ['Envelope.dc.html', 'Capability envelope', 1720], ['Storage.dc.html', 'Storage · Exps 1–3', 1180],
  ['Modes.dc.html', 'Modes & coupling · Exps 4–5', 1000], ['Dynamics.dc.html', 'Regimes & clocks · Exps 6, 10', 1000], ['Temporal.dc.html', 'Reservoir & control · Exps 15, 17', 1000],
  ['Logic.dc.html', 'Memory & logic · Exps 2, 7–9, 11–14', 1760], ['Hardware.dc.html', 'Hardware · Exps 18–19', 940], ['Implications.dc.html', 'Implications & next', 1420],
]
const rowH = [1720, 1000, 1760]
const artboards = layout.map(([file, title, h], i) => ({ file, title, x: (i % 3) * (W + GX), y: rowH.slice(0, Math.floor(i / 3)).reduce((a, b) => a + b + GY, 0), w: W, h }))
writeFileSync(new URL('canvas.json', import.meta.url), JSON.stringify({ artboards, launch: { view: 'canvas' } }, null, 2))
console.log('wrote', Object.keys(files).length, 'artboards')
