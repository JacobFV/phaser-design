#!/bin/bash
# Experiment 16 associative-memory design + JS evaluation, gated on the Exp 7–10 queue.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export TORCH_THREADS=3 OMP_NUM_THREADS=3 VECLIB_MAXIMUM_THREADS=3
while ps -Ao command | grep -q "[0]8-queue.sh"; do sleep 60; done
TAG=assoc_nl_5pat
P='{"twin":"A64s","G0":2.2,"s":-0.6,"Ia":0.05,"I_hi":0.5,"I_lo":0.08,"bg_max":3.0,"w_bg":0.05,"lr":0.05,"noise":0.01,"pitch":5,"w":2,"patterns":["circle","cross","smile","rand1","rand2"],"train_flips":[4,8],"reps":2,"T":120,"settle":60,"iters":250,"tag":"assoc_nl_5pat"}'
[ -f out/08/${TAG}_spec.json ] || python 08-design.py assoc "$P" > out/08/logs/${TAG}.log 2>&1
[ -f out/08/${TAG}_spec.json ] && npx vite-node 08-eval.ts out/08/${TAG}_spec.json 3000 > out/08/logs/eval_${TAG}.log 2>&1
[ -f out/08/${TAG}_spec.json ] && npx vite-node 16-basin.ts out/08/${TAG}_spec.json 3000 > out/16/logs/basin_${TAG}.log 2>&1
echo queue16 done
