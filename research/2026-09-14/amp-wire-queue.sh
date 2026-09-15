#!/bin/bash
# Threshold-1 coupling on the absorbing-mask architecture: a persistent wire (copy src → dst, both latched) and OR with a rail.
# Gated on amp-seq-queue.sh (which itself waits for amp-queue.sh). Each re-evaluated in JS to 1e4 trips.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
sleep 120
while ps -Ao args= | awk '$1 ~ /bash$/ && ($2 ~ /amp-seq-queue\.sh$/ || $2 ~ /amp-queue\.sh$/) {f=1} END {exit !f}'; do sleep 60; done
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
A='"twin":"A64s_amp","G0":3.0,"s":-0.8,"Ia":0.2,"I_hi":0.6,"I_lo":0.1,"bg_max":10,"w_bg":0,"lr":0.05,"lr_amp":0.2,"noise":0.01,"w":3,"w_stat":5.0,"stat_frac":0.4,"amp_margin":0,"amp_bg":-1'
design wire "{$A,\"dist\":6,\"T\":200,\"settle\":80,\"reps\":2,\"iters\":250,\"tag\":\"amp_wire_d6\"}"
design gate "{$A,\"gate\":\"OR\",\"dist\":6,\"rails\":1,\"T\":200,\"settle\":80,\"iters\":250,\"tag\":\"amp_gate_OR_rail\"}"
echo amp-wire-queue done
