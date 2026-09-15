#!/bin/bash
# Experiment 1 production runs (parallel background jobs)
cd "$(dirname "$0")"
R() { npx vite-node 01-dot.ts "$@"; }
mkdir -p out/01/logs
(R img 100000 3,5,7) > out/01/logs/j1.log 2>&1 &
(R img 100000 10,14) > out/01/logs/j2.log 2>&1 &
(R img 100000 20,28) > out/01/logs/j3.log 2>&1 &
(R img 100000 40,57,80) > out/01/logs/j4.log 2>&1 &
(R preset 1000 3,5,7,10,14,20,28,40,57,80; R img_rand 10000 10,20,40; R img_ferr1e3 10000 10,20,40; R img_ferr1e2 10000 10,20,40; R img_full 10000 10,20; R img_spp4 10000 3,5,10) > out/01/logs/j5.log 2>&1 &
(R B_4f 10000 16,32,64,128; R C_mla 10000 32,64,96,128) > out/01/logs/j6.log 2>&1 &
wait
