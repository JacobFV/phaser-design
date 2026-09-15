#!/bin/bash
# Absorbing-amplitude-mask design queue (Experiments 2nl, 8, 9, 11, 12, 16): static phase program + static absorbing amplitude
# program, optimised jointly through the validated twin (A64s_amp, 1.6e-14 vs JS), each re-evaluated in JS to 1e4 trips.
# Operating point from the hand-built absorbing-mask memory (02-nl-amp.ts): G0 3, s −0.8, I_a 0.2.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=2 OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
design() {
  local tag; tag=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['tag'])" "$2")
  if [ ! -f "out/08/${tag}_spec.json" ]; then python 08-design.py "$1" "$2" > "out/08/logs/${tag}.log" 2>&1; fi
  [ -f "out/08/${tag}_spec.json" ] && npx vite-node 08-eval.ts "out/08/${tag}_spec.json" 10000 > "out/08/logs/eval_${tag}.log" 2>&1
}
A='"twin":"A64s_amp","G0":3.0,"s":-0.8,"Ia":0.2,"I_hi":0.6,"I_lo":0.1,"bg_max":10,"w_bg":0,"lr":0.05,"lr_amp":0.2,"noise":0.01,"w":3,"w_stat":5.0,"stat_frac":0.4'

# Experiment 2 (nonlinear, round 4): designed memory at the hand-found pitch, and denser
design memory "{$A,\"side\":3,\"pitch\":6,\"batch\":8,\"T\":300,\"iters\":150,\"amp_margin\":0,\"amp_bg\":-4,\"tag\":\"amp_mem9_p6\"}"
design memory "{$A,\"side\":4,\"pitch\":5,\"batch\":8,\"T\":300,\"iters\":200,\"amp_margin\":0,\"amp_bg\":-4,\"tag\":\"amp_mem16_p5\"}"
# Experiment 8: gates (inputs and outputs are bistable cells; rails = always-on power cells); gaps start partly open (amp_bg −1)
for g in AND OR XOR NAND NOT; do
  rails=1; [ "$g" = "AND" ] && rails=0; [ "$g" = "OR" ] && rails=0
  design gate "{$A,\"gate\":\"$g\",\"dist\":6,\"rails\":$rails,\"T\":200,\"settle\":80,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_gate_$g\"}"
done
# Experiment 9: set/reset latch (reset pulse arrives π out of phase in the R region)
design latch "{$A,\"dist\":6,\"rails\":1,\"T\":240,\"t_pulse\":60,\"gap\":80,\"settle\":25,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_latch\"}"
# Experiments 11/14: direct spatial compilation, persistent
for fn in halfadd fulladd satstep2 parity4; do
  design boolfn "{$A,\"fn\":\"$fn\",\"rails\":1,\"T\":240,\"settle\":80,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_bool_${fn}\"}"
done
# Experiment 12 fallback: countdown + halt as a static transition graph
design countdown "{$A,\"w_stat\":2.0,\"stat_frac\":0.3,\"N\":4,\"period\":20,\"settle\":6,\"T\":160,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_countdown4\"}"
# Experiment 16: associative memory with absorbing cells (8×8 cells, 5 px pitch, 3 px cells)
design assoc "{$A,\"pitch\":5,\"w\":3,\"patterns\":[\"circle\",\"cross\",\"smile\",\"rand1\",\"rand2\"],\"train_flips\":[4,8],\"reps\":2,\"T\":200,\"settle\":100,\"iters\":250,\"amp_margin\":0,\"amp_bg\":-1,\"tag\":\"amp_assoc_5pat\"}"
[ -f out/08/amp_assoc_5pat_spec.json ] && npx vite-node 16-basin.ts out/08/amp_assoc_5pat_spec.json 3000 > out/16/logs/basin_amp_assoc_5pat.log 2>&1
echo amp-queue done
