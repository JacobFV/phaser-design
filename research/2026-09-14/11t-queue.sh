#!/bin/bash
# Phase-only TRANSIENT (read-once) spatial compilation of small truth tables, gated on amp-queue.sh.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
while ps -Ao args= | awk '$1 ~ /bash$/ && $2 ~ /amp-queue\.sh$/ {f=1} END {exit !f}'; do sleep 60; done
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
NL='"twin":"A64s","G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"w":3'
for fn in halfadd fulladd parity4 add2 satstep2; do
  design boolfn "{$NL,\"fn\":\"$fn\",\"rails\":1,\"T\":60,\"settle\":30,\"iters\":250,\"tag\":\"bool_${fn}_transient\"}"
done
design boolfn "{$NL,\"fn\":\"parity8\",\"rails\":1,\"T\":60,\"settle\":30,\"max_cases\":64,\"iters\":250,\"tag\":\"bool_parity8_transient\"}"
echo queue11t done
