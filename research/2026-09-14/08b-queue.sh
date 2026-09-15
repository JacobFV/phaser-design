#!/bin/bash
# Remaining linear / sequencing items of the Exp 7–10 queue (phase-only nonlinear gates/latch superseded by amp-queue.sh).
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
while ps -Ao args= | awk '$1 ~ /node/ && $0 ~ /08-eval.ts out\/08\/wire_lin_d8_spec2_sd5/ {f=1} END {exit !f}'; do sleep 60; done
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
LIN='"twin":"A64sd5","linear":true,"Glin":1.45,"w":3,"bg_max":10,"w_bg":0,"lr":0.05,"noise":0.0'
NL='"G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"w":3'
design wire "{\"twin\":\"A64s\",\"linear\":true,\"Glin\":1.45,\"w\":3,\"bg_max\":10,\"w_bg\":0,\"lr\":0.05,\"noise\":0.0,\"dist\":8,\"T\":150,\"settle\":20,\"reps\":1,\"I_hi\":0.2,\"I_lo\":0.03,\"iters\":200,\"tag\":\"wire_lin_d8_nodefocus\"}"
design gate "{$LIN,\"gate\":\"NOT\",\"dist\":8,\"rails\":1,\"T\":150,\"settle\":30,\"preserve_inputs\":false,\"I_hi\":0.15,\"I_lo\":0.03,\"iters\":200,\"tag\":\"gate_lin_NOT_sd5\"}"
design toggle "{\"twin\":\"A64sd5\",$NL,\"radius\":6,\"period\":10,\"settle\":4,\"T\":120,\"iters\":250,\"tag\":\"toggle_nl_p10\"}"
design ring "{\"twin\":\"A64sd5\",$NL,\"N\":4,\"radius\":8,\"period\":10,\"settle\":4,\"T\":120,\"iters\":250,\"tag\":\"ring4_nl_p10\"}"
design ring "{$LIN,\"N\":4,\"radius\":8,\"period\":10,\"settle\":4,\"T\":120,\"I_hi\":0.15,\"I_lo\":0.03,\"iters\":250,\"tag\":\"ring4_lin_p10\"}"
echo queue08b done
