[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/FiluFafayo/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/FiluFafayo/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# Push-optimal Sokoban solver

Entry for the [make.fun](https://make.fun/c/sokoban-solver-01-run-20261121)
sokoban-solver-01-run-20261121 bounty ($100).

`main.ts` (Node 22, no dependencies) reads every level in
`/input/<id>/level.txt` and writes its moves to
`/output/<id>/solution.txt`.

## Approach

The generated levels are a one-cell-wide hallway with 1–4 rooms
hanging off it, one door each, and a box pushed out of its room can
never come back — so every box stays in its room and a level's
push-optimal count is the sum of its rooms' optima. The solver:

1. Splits the level into hallway + rooms (connected components of
   the floor outside the hallway row/column), validating that each
   room holds as many boxes as goals and has exactly one door.
2. Solves each room on its own with a push-optimal A*: push
   macro-moves, a min-assignment heuristic over BFS distances,
   corner / 2×2 / wall-line deadlock pruning, and the player's
   position canonicalised to its reachable region.
3. Sequences the rooms so the player can always walk out of a room
   again (the room whose exit costs the most pushes goes last) and
   joins the rooms with plain BFS walks through the hallway.

Everything is deterministic: budgets are counted in expansions,
never in wall-clock time, and no randomness is used.

On the kit's practice set it solves all 5 instances at the
push-optimal counts (13, 16, 29, 47, 60 pushes) in about 2 seconds.

Run locally: `mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts`
