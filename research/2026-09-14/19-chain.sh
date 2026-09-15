#!/bin/bash
# Experiment 19 analysis chain: coupling + flat-FOV packing at 450/532 nm (650 nm already done), gated on running numpy jobs.
cd "$(dirname "$0")"
source /private/tmp/claude-504/-Users-vibestartup-Code-phaser-design/0e63674b-7461-4a57-ace5-b5d3facc5ac4/scratchpad/venv/bin/activate
export OMP_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2
until [ -f out/02/packing_A_img_fov200.json ]; do sleep 60; done
for op in A_img_450 A_img_532; do
  python 04-coupling.py coupling $op 100e-6 30e-6 152e-6 > out/04/coupling_$op.log 2>&1
  FOV_HALF=200e-6 TAG=_fov200 python 02-linear-packing.py $op 20 > out/02/packing_${op}_fov200.log 2>&1
done
until [ -f out/05/B_4f_532_summary.json ]; do sleep 60; done
FOV_HALF=400e-6 TAG=_fov400 python 02-linear-packing.py B_4f 20 > out/02/packing_B_4f_fov400.log 2>&1
for op in B_4f_450 B_4f_532; do
  python 04-coupling.py coupling $op 190.5e-6 60e-6 200e-6 > out/04/coupling_$op.log 2>&1
  FOV_HALF=400e-6 TAG=_fov400 python 02-linear-packing.py $op 20 > out/02/packing_${op}_fov400.log 2>&1
done
echo chain19 done
