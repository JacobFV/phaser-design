#!/bin/bash
# Experiment 12 fallback: a looping program compiled directly into a static spatial transition graph (countdown + halt),
# gated on the Exp 11/14 queue. Each design is re-evaluated in JS to 1e4 trips (the halt state must persist).
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
while ps -Ao args= | awk '$1 ~ /bash$/ && $2 ~ /11-queue\.sh$/ {f=1} END {exit !f}'; do sleep 60; done
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
NL='"G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"w":3'
design countdown "{\"twin\":\"A64sd5\",$NL,\"w_stat\":2.0,\"stat_frac\":0.3,\"N\":4,\"period\":20,\"settle\":6,\"T\":160,\"iters\":250,\"tag\":\"countdown4_nl_sd5_persist\"}"
design countdown "{\"twin\":\"A64sd5\",$NL,\"N\":4,\"period\":20,\"settle\":6,\"T\":120,\"iters\":250,\"tag\":\"countdown4_nl_sd5_transient\"}"
design countdown "{\"twin\":\"A64s\",$NL,\"w_stat\":2.0,\"stat_frac\":0.3,\"N\":4,\"period\":20,\"settle\":6,\"T\":160,\"iters\":250,\"tag\":\"countdown4_nl_s_persist\"}"
echo queue12 done
