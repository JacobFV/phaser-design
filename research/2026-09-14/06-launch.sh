#!/bin/bash
cd "$(dirname "$0")"
mkdir -p out/06/logs
G="1.6,1.8,1.9,2.0,2.1,2.2,2.4,2.6,3.0,3.5,4.0"; S="-0.2,-0.4,-0.6,-0.8"
(for k in 0 1; do npx vite-node 06-regime.ts zero $k $G $S 3000; done) > out/06/logs/zero.log 2>&1 &
(for k in 0 1; do CELLPX=3 PITCHPX=5 CELLS=9 npx vite-node 06-regime.ts moat $k $G $S 3000; done) > out/06/logs/moat3.log 2>&1 &
(for k in 0 1; do CELLPX=4 PITCHPX=6 CELLS=8 npx vite-node 06-regime.ts moat $k $G $S 3000; done) > out/06/logs/moat4.log 2>&1 &
wait
