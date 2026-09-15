#!/bin/bash
# Rerun of the absorbing-mask boolfn designs with a layout the architecture can hold (Exp. 2nl: 2 px gaps die, 3 px gaps hold):
# 3 px cells on a 6 px step, inputs latched (preserve_inputs), input/output columns 18 px apart, rail between them.
# The first attempt (gap 2, inputs 37 px from outputs, rail 23 px away) went extinct at iteration 0 (zero gradient).
# Then the Exp. 12 countdown and Exp. 16 associative memory items from amp-queue.sh. Gated on 11t-queue.sh (≤ 2 torch jobs).
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
sleep 120
while ps -Ao args= | awk '$1 ~ /bash$/ && $2 ~ /11t-queue\.sh$/ {f=1} END {exit !f}'; do sleep 60; done
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
A='"twin":"A64s_amp","G0":3.0,"s":-0.8,"Ia":0.2,"I_hi":0.6,"I_lo":0.1,"bg_max":10,"w_bg":0,"lr":0.05,"lr_amp":0.2,"noise":0.01,"w":3,"w_stat":5.0,"stat_frac":0.4'
L='"gap":3,"x_in":20,"x_out":38,"rail_x":29,"rail_y":44,"preserve_inputs":true'
for fn in halfadd fulladd satstep2 parity4; do
  design boolfn "{$A,$L,\"fn\":\"$fn\",\"rails\":1,\"T\":240,\"settle\":80,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp2_bool_${fn}\"}"
done
design countdown "{$A,\"w_stat\":2.0,\"stat_frac\":0.3,\"N\":4,\"period\":20,\"settle\":6,\"T\":160,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_countdown4\"}"
design assoc "{$A,\"pitch\":5,\"w\":3,\"patterns\":[\"circle\",\"cross\",\"smile\",\"rand1\",\"rand2\"],\"train_flips\":[4,8],\"reps\":2,\"T\":200,\"settle\":100,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_assoc_5pat\"}"
[ -f out/08/amp_assoc_5pat_spec.json ] && npx vite-node 16-basin.ts out/08/amp_assoc_5pat_spec.json 3000 > out/16/logs/basin_amp_assoc_5pat.log 2>&1
echo amp-queue2 done
