#!/bin/bash
# Serial queue for Experiments 7–10 designs: one torch design at a time, each followed by its JS re-evaluation.
# Gated on the running memory design so the 8 GB machine is not oversubscribed.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2

design() { # $1 task, $2 json (must contain "tag")
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}

LIN='"twin":"A64sd5","linear":true,"Glin":1.45,"w":3,"bg_max":10,"w_bg":0,"lr":0.05,"noise":0.0'
NL='"twin":"A64s","G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"w":3'
NLS="$NL"',"w_stat":5.0,"stat_frac":0.4'  # idempotent targets: outputs must reach fixed points

# Experiment 7 — wires (linear, gain-clamped): distance, spectators, defocus needed?
design wire "{$LIN,\"dist\":4,\"T\":150,\"settle\":20,\"reps\":1,\"I_hi\":0.2,\"I_lo\":0.03,\"iters\":200,\"tag\":\"wire_lin_d4_sd5\"}"
design wire "{$LIN,\"dist\":16,\"T\":150,\"settle\":40,\"reps\":1,\"I_hi\":0.2,\"I_lo\":0.03,\"iters\":200,\"tag\":\"wire_lin_d16_sd5\"}"
design wire "{$LIN,\"dist\":24,\"T\":150,\"settle\":60,\"reps\":1,\"I_hi\":0.2,\"I_lo\":0.03,\"iters\":200,\"tag\":\"wire_lin_d24_sd5\"}"
design wire "{$LIN,\"dist\":8,\"T\":150,\"settle\":20,\"reps\":3,\"spectators\":2,\"I_hi\":0.15,\"I_lo\":0.03,\"iters\":250,\"tag\":\"wire_lin_d8_spec2_sd5\"}"
design wire "{\"twin\":\"A64s\",\"linear\":true,\"Glin\":1.45,\"w\":3,\"bg_max\":10,\"w_bg\":0,\"lr\":0.05,\"noise\":0.0,\"dist\":8,\"T\":150,\"settle\":20,\"reps\":1,\"I_hi\":0.2,\"I_lo\":0.03,\"iters\":200,\"tag\":\"wire_lin_d8_nodefocus\"}"
# Experiment 8 — gates: linear NOT (interference with a rail), nonlinear AND / NAND / XOR / NOT with rails
design gate "{$LIN,\"gate\":\"NOT\",\"dist\":8,\"rails\":1,\"T\":150,\"settle\":30,\"preserve_inputs\":false,\"I_hi\":0.15,\"I_lo\":0.03,\"iters\":200,\"tag\":\"gate_lin_NOT_sd5\"}"
design gate "{$NLS,\"gate\":\"AND\",\"dist\":8,\"rails\":0,\"T\":150,\"settle\":50,\"iters\":250,\"tag\":\"gate_nl_AND\"}"
design gate "{$NLS,\"gate\":\"XOR\",\"dist\":8,\"rails\":1,\"T\":150,\"settle\":50,\"iters\":250,\"tag\":\"gate_nl_XOR\"}"
design gate "{$NLS,\"gate\":\"NAND\",\"dist\":8,\"rails\":1,\"T\":150,\"settle\":50,\"iters\":250,\"tag\":\"gate_nl_NAND\"}"
design gate "{$NLS,\"gate\":\"NOT\",\"dist\":8,\"rails\":1,\"T\":150,\"settle\":50,\"iters\":250,\"tag\":\"gate_nl_NOT\"}"
# Experiment 9 — set/reset latch (nonlinear)
design latch "{$NLS,\"dist\":7,\"rails\":1,\"T\":200,\"t_pulse\":40,\"gap\":70,\"settle\":20,\"iters\":250,\"tag\":\"latch_nl\"}"
# Experiment 10 — designed autonomous sequencing: 2-cell toggle and 4-cell one-hot ring (nonlinear), linear ring on defocused cavity
design toggle "{$NL,\"twin\":\"A64sd5\",\"w\":3,\"radius\":6,\"period\":10,\"settle\":4,\"T\":120,\"iters\":250,\"tag\":\"toggle_nl_p10\"}"
design ring "{$NL,\"twin\":\"A64sd5\",\"N\":4,\"w\":3,\"radius\":8,\"period\":10,\"settle\":4,\"T\":120,\"iters\":250,\"tag\":\"ring4_nl_p10\"}"
design ring "{$LIN,\"N\":4,\"radius\":8,\"period\":10,\"settle\":4,\"T\":120,\"I_hi\":0.15,\"I_lo\":0.03,\"iters\":250,\"tag\":\"ring4_lin_p10\"}"
echo queue done
