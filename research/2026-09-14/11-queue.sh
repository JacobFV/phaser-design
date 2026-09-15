#!/bin/bash
# Experiments 11 & 14: direct static spatial compilation of small truth tables (persistent and transient variants),
# each re-evaluated in JS. Runs in parallel with 08-queue.sh (2 torch threads each).
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
NL='"twin":"A64s","G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"w":3'
STAT='"w_stat":5.0,"stat_frac":0.4'
# persistent (idempotent) variants: outputs must settle by trip 60 and hold to 200 with stationarity
for fn in halfadd fulladd satstep2 parity4 add2; do
  design boolfn "{$NL,$STAT,\"fn\":\"$fn\",\"rails\":1,\"T\":200,\"settle\":60,\"iters\":250,\"tag\":\"bool_${fn}_persist\"}"
done
# transient variants: outputs only need to be correct in trips 30–60 (read-once spatial compilation)
for fn in halfadd fulladd parity4 add2 satstep2; do
  design boolfn "{$NL,\"fn\":\"$fn\",\"rails\":1,\"T\":60,\"settle\":30,\"iters\":250,\"tag\":\"bool_${fn}_transient\"}"
done
design boolfn "{$NL,\"fn\":\"parity8\",\"rails\":1,\"T\":60,\"settle\":30,\"max_cases\":64,\"iters\":250,\"tag\":\"bool_parity8_transient\"}"
echo queue11 done
