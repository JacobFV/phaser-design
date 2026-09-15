#!/bin/bash
# Experiment 17 follow-ups, gated on the running A_preset K sweep.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
while ps -Ao args= | awk '$1 ~ /python/ && $2 == "17-control.py" {f=1} END {exit !f}'; do sleep 60; done
GAIN_MARGIN=0.9 TAG=_gm0.9 python 17-control.py A_preset 1,10,100 0.05 > out/17/control_A_preset_gm0.9.log 2>&1
TAG=_img python 17-control.py A_img 1,10,100,1000 0.05 > out/17/control_A_img.log 2>&1
echo chain17 done
