// Sokoban solver entry for make.fun sokoban-solver-01-run-20261121.
// Original code, written for this competition.
//
// The generated levels are a one-cell-wide hallway with 1-4 rooms
// (6x6 slots) hanging off it, one door each; a box pushed out of its
// room can never come back, so every box stays in its room and the
// push-optimal count of a level is the sum of its rooms' optima.
// Each room is therefore solved on its own with a push-optimal A*
// (push macro-moves; min-assignment heuristic over BFS distances;
// corner / 2x2 / wall-line deadlock pruning; the player's position
// canonicalised to its reachable region), the rooms are sequenced so
// the player can always walk out of a room again, and the walks
// between rooms are plain BFS. Deterministic: every budget is counted
// in expansions, never in wall-clock time, and no randomness is used.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];

const ROOM_EXPANSIONS = 200000;
const MAX_ROOM_STATES = 200000;
const GLOBAL_EXPANSIONS = 1000000;
let expansionsUsed = 0;

type Level = {
  w: number;
  h: number;
  wall: boolean[];
  goals: Set<number>;
  boxes: number[];
  player: number;
};

type Room = {
  floor: Uint8Array; // room cells only (walkable for boxes and player)
  entry: number; // hallway cell outside the room (walkable for player only)
  door: number; // room cell adjacent to entry
  goals: number[];
  boxes: number[];
};

type Push = { box: number; dir: number };

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall: boolean[] = new Array(w * h).fill(true);
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      wall[i] = ch === '#';
      if ('.*+'.includes(ch)) goals.add(i);
      if ('$*'.includes(ch)) boxes.push(i);
      if ('@+'.includes(ch)) player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Breadth-first region from `start` over walkable cells, avoiding
// `blocked` cells. Returns the region mask and its smallest cell.
function bfsRegion(
  start: number,
  walkable: Uint8Array,
  blocked: Uint8Array,
  n: number,
  w: number,
): { region: Uint8Array; min: number } {
  const region = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  region[start] = 1;
  q[qt++] = start;
  let min = start;
  while (qh < qt) {
    const c = q[qh++]!;
    if (c < min) min = c;
    const x = c % w;
    const y = (c / w) | 0;
    if (x > 0) {
      const nb = c - 1;
      if (walkable[nb] && !blocked[nb] && !region[nb]) { region[nb] = 1; q[qt++] = nb; }
    }
    if (x + 1 < w) {
      const nb = c + 1;
      if (walkable[nb] && !blocked[nb] && !region[nb]) { region[nb] = 1; q[qt++] = nb; }
    }
    if (y > 0) {
      const nb = c - w;
      if (walkable[nb] && !blocked[nb] && !region[nb]) { region[nb] = 1; q[qt++] = nb; }
    }
    if (y + 1 < (n / w | 0)) {
      const nb = c + w;
      if (walkable[nb] && !blocked[nb] && !region[nb]) { region[nb] = 1; q[qt++] = nb; }
    }
  }
  return { region, min };
}

// BFS distances from `from` over walkable cells (-1 = unreachable).
function bfsDist(from: number, walkable: Uint8Array, n: number, w: number): Int32Array {
  const dist = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  dist[from] = 0;
  q[qt++] = from;
  const h = n / w | 0;
  while (qh < qt) {
    const c = q[qh++]!;
    const d = dist[c]! + 1;
    const x = c % w;
    const y = (c / w) | 0;
    if (x > 0 && walkable[c - 1] && dist[c - 1] < 0) { dist[c - 1] = d; q[qt++] = c - 1; }
    if (x + 1 < w && walkable[c + 1] && dist[c + 1] < 0) { dist[c + 1] = d; q[qt++] = c + 1; }
    if (y > 0 && walkable[c - w] && dist[c - w] < 0) { dist[c - w] = d; q[qt++] = c - w; }
    if (y + 1 < h && walkable[c + w] && dist[c + w] < 0) { dist[c + w] = d; q[qt++] = c + w; }
  }
  return dist;
}

// Shortest walk from `from` to `to` over walkable cells avoiding
// `blocked` cells; returns the move letters (lowercase) or null.
function bfsPath(
  from: number,
  to: number,
  walkable: Uint8Array,
  blocked: Uint8Array,
  n: number,
  w: number,
): string | null {
  if (from === to) return '';
  const prev = new Int32Array(n).fill(-2);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  prev[from] = -1;
  q[qt++] = from;
  const h = n / w | 0;
  while (qh < qt) {
    const c = q[qh++]!;
    const x = c % w;
    const y = (c / w) | 0;
    for (let d = 0; d < 4; d++) {
      const dir = DIRS[d]!;
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nb = ny * w + nx;
      if (!walkable[nb] || blocked[nb] || prev[nb] !== -2) continue;
      prev[nb] = c;
      if (nb === to) {
        let s = '';
        let cur = nb;
        while (cur !== from) {
          const p = prev[cur]!;
          const dd = cur - p;
          s = (dd === 1 ? 'r' : dd === -1 ? 'l' : dd === w ? 'd' : 'u') + s;
          cur = p;
        }
        return s;
      }
      q[qt++] = nb;
    }
  }
  return null;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i);
  const gen = (k: number): void => {
    if (k === n) { out.push(a.slice()); return; }
    for (let i = k; i < n; i++) {
      const t = a[k]!; a[k] = a[i]!; a[i] = t;
      gen(k + 1);
      const t2 = a[k]!; a[k] = a[i]!; a[i] = t2;
    }
  };
  gen(0);
  return out;
}

// Push-optimal A* for one room. The player starts on `room.entry`.
// With requireExit, the goal state must also let the player walk back
// out through the door. Returns the push list, or null.
function solveRoom(room: Room, w: number, h: number, requireExit: boolean): Push[] | null {
  const n = w * h;
  const walkable = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (room.floor[i]) walkable[i] = 1;
  walkable[room.entry] = 1;
  const goalsSet = new Set(room.goals);
  const goalDist = room.goals.map((g) => bfsDist(g, walkable, n, w));
  const perms = permutations(room.boxes.length);
  const boxCount = room.boxes.length;

  const heuristic = (boxes: number[]): number => {
    let best = Infinity;
    for (const perm of perms) {
      let s = 0;
      for (let i = 0; i < boxCount; i++) {
        const d = goalDist[perm[i]!]![boxes[i]!]!;
        if (d < 0) { s = Infinity; break; }
        s += d;
      }
      if (s < best) best = s;
    }
    return best;
  };

  // True when some box can never reach a goal: corner, frozen 2x2
  // block, or a wall line with no goal on it.
  const deadlocked = (boxes: number[], blocked: Uint8Array): boolean => {
    for (const b of boxes) {
      if (goalsSet.has(b)) continue;
      const x = b % w;
      const y = (b / w) | 0;
      const up = y > 0 ? b - w : -1;
      const down = y + 1 < h ? b + w : -1;
      const left = x > 0 ? b - 1 : -1;
      const right = x + 1 < w ? b + 1 : -1;
      const blockedAt = (c: number): boolean => c < 0 || !walkable[c];
      // Corner: two perpendicular blocked neighbours.
      if (
        (blockedAt(up) && blockedAt(left)) || (blockedAt(up) && blockedAt(right)) ||
        (blockedAt(down) && blockedAt(left)) || (blockedAt(down) && blockedAt(right))
      ) return true;
      // Frozen 2x2 block of walls/boxes containing this box.
      const occ = (c: number): boolean => c < 0 || !walkable[c] || !!blocked[c];
      const squares: number[][] = [
        [b, b + 1, b + w, b + w + 1],
        [b, b - 1, b + w, b + w - 1],
        [b, b + 1, b - w, b - w + 1],
        [b, b - 1, b - w, b - w - 1],
      ];
      for (const sq of squares) {
        // Skip squares that wrap around a row edge.
        const xs = sq.map((c) => (c < 0 || c >= n ? -99 : c % w));
        if (Math.max(...xs) - Math.min(...xs) > 1) continue;
        if (sq.every((c) => occ(c))) return true;
      }
      // Wall line: box against a wall, no goal anywhere on that run,
      // and the run closed at both ends (a run open at an end lets
      // the box slide out past it, so it is not a deadlock).
      const runs: { side: number; step: number }[] = [
        { side: up, step: 1 },
        { side: down, step: 1 },
        { side: left, step: w },
        { side: right, step: w },
      ];
      for (const { side, step } of runs) {
        if (!blockedAt(side)) continue;
        const horizontal = step === 1;
        const startRow = (b / w) | 0;
        const sideCell = (c: number): number => {
          const cx = c % w;
          const cy = (c / w) | 0;
          return side === up ? (cy > 0 ? c - w : -1)
            : side === down ? (cy + 1 < h ? c + w : -1)
            : side === left ? (cx > 0 ? c - 1 : -1)
            : (cx + 1 < w ? c + 1 : -1);
        };
        let hasGoal = goalsSet.has(b);
        let closed = true;
        for (const dirStep of [step, -step]) {
          for (let c = b + dirStep; ; c += dirStep) {
            if (c < 0 || c >= n || (horizontal && ((c / w) | 0) !== startRow) || !walkable[c]) break;
            if (!blockedAt(sideCell(c))) { closed = false; break; }
            if (goalsSet.has(c)) hasGoal = true;
          }
        }
        if (closed && !hasGoal) return true;
      }
    }
    return false;
  };

  const keyOf = (boxes: number[], cplayer: number): string =>
    `${cplayer}|${boxes.join(',')}`;

  const startBlocked = new Uint8Array(n);
  for (const b of room.boxes) startBlocked[b] = 1;
  const startRegion = bfsRegion(room.entry, walkable, startBlocked, n, w);
  const startBoxes = room.boxes.slice();

  // A* state arrays.
  const stBoxes: number[][] = [startBoxes];
  const stPlayer: number[] = [startRegion.min];
  const stG: number[] = [0];
  const stParent: number[] = [-1];
  const stPushBox: number[] = [-1];
  const stPushDir: number[] = [-1];
  const best = new Map<string, number>();
  best.set(keyOf(startBoxes, startRegion.min), 0);

  // Binary heap of [f, h, seq, state], smallest first.
  const heap: number[][] = [];
  const h0 = heuristic(startBoxes);
  if (!Number.isFinite(h0)) return null;
  let seq = 0;
  const heapLess = (a: number[], b: number[]): boolean =>
    a[0]! < b[0]! || (a[0]! === b[0]! && (a[1]! < b[1]! || (a[1]! === b[1]! && a[2]! < b[2]!)));
  const heapPush = (e: number[]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      const t = heap[i]!; heap[i] = heap[p]!; heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): number[] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        const t = heap[i]!; heap[i] = heap[c]!; heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  heapPush([h0, h0, seq++, 0]);

  let expansionsThis = 0;
  while (heap.length > 0) {
    const [, , , s] = heapPop();
    const boxes = stBoxes[s]!;
    const g = stG[s]!;
    if (best.get(keyOf(boxes, stPlayer[s]!)) !== s) continue;
    if (boxes.every((b) => goalsSet.has(b))) {
      if (!requireExit) {
        const pushes: Push[] = [];
        for (let t = s; t > 0; t = stParent[t]!) {
          pushes.push({ box: stPushBox[t]!, dir: stPushDir[t]! });
        }
        pushes.reverse();
        return pushes;
      }
      const blocked = new Uint8Array(n);
      for (const b of boxes) blocked[b] = 1;
      const region = bfsRegion(stPlayer[s]!, walkable, blocked, n, w);
      if (region.region[room.door]) {
        const pushes: Push[] = [];
        for (let t = s; t > 0; t = stParent[t]!) {
          pushes.push({ box: stPushBox[t]!, dir: stPushDir[t]! });
        }
        pushes.reverse();
        return pushes;
      }
      // All boxes home but the player cannot leave: keep searching,
      // a longer route may end with the player on the exit side.
    }
    if (expansionsThis >= ROOM_EXPANSIONS || expansionsUsed >= GLOBAL_EXPANSIONS) return null;
    expansionsThis++;
    expansionsUsed++;
    const blocked = new Uint8Array(n);
    for (const b of boxes) blocked[b] = 1;
    const { region } = bfsRegion(stPlayer[s]!, walkable, blocked, n, w);
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      const bx = b % w;
      const by = (b / w) | 0;
      for (let d = 0; d < 4; d++) {
        const dir = DIRS[d]!;
        const tx = bx + dir.dx;
        const ty = by + dir.dy;
        if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
        const t = ty * w + tx;
        if (!room.floor[t] || blocked[t]) continue;
        const fx = bx - dir.dx;
        const fy = by - dir.dy;
        if (fx < 0 || fx >= w || fy < 0 || fy >= h) continue;
        const f = fy * w + fx;
        if (!region[f]) continue;
        const nb = boxes.slice();
        nb[bi] = t;
        nb.sort((a, bb) => a - bb);
        const nblocked = new Uint8Array(n);
        for (const x of nb) nblocked[x] = 1;
        if (deadlocked(nb, nblocked)) continue;
        const hh = heuristic(nb);
        if (!Number.isFinite(hh)) continue;
        const g2 = g + 1;
        const nregion = bfsRegion(b, walkable, nblocked, n, w);
        const k = keyOf(nb, nregion.min);
        const seen = best.get(k);
        if (seen !== undefined && stG[seen]! <= g2) continue;
        if (stBoxes.length >= MAX_ROOM_STATES) return null;
        const idx = stBoxes.length;
        stBoxes.push(nb);
        stPlayer.push(nregion.min);
        stG.push(g2);
        stParent.push(s);
        stPushBox.push(b);
        stPushDir.push(d);
        best.set(k, idx);
        heapPush([g2 + hh, hh, seq++, idx]);
      }
    }
  }
  return null;
}

// Replay a room's pushes into concrete moves, starting with the
// player on `start`. Returns the moves and the final player cell.
function replayPushes(
  room: Room,
  pushes: Push[],
  start: number,
  w: number,
  h: number,
): { moves: string; endPlayer: number } | null {
  const n = w * h;
  const walkable = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (room.floor[i]) walkable[i] = 1;
  walkable[room.entry] = 1;
  const boxSet = new Set(room.boxes);
  let player = start;
  let moves = '';
  for (const { box, dir } of pushes) {
    const d = DIRS[dir]!;
    const from = box - d.dy * w - d.dx;
    const to = box + d.dy * w + d.dx;
    const blocked = new Uint8Array(n);
    for (const b of boxSet) blocked[b] = 1;
    const walk = bfsPath(player, from, walkable, blocked, n, w);
    if (walk === null) return null;
    moves += walk;
    moves += d.ch.toUpperCase();
    boxSet.delete(box);
    boxSet.add(to);
    player = box;
  }
  return { moves, endPlayer: player };
}

// Split a level into hallway + rooms. `rowMode` uses the player's row
// as the hallway; otherwise the player's column. Returns null when the
// split does not validate (boxes/goals per room, exactly one door).
function decompose(level: Level, rowMode: boolean): Room[] | null {
  const { w, h } = level;
  const n = w * h;
  const hallway = new Uint8Array(n);
  if (rowMode) {
    const y0 = (level.player / w) | 0;
    for (let x = 0; x < w; x++) hallway[y0 * w + x] = 1;
  } else {
    const x0 = level.player % w;
    for (let y = 0; y < h; y++) hallway[y * w + x0] = 1;
  }
  const seen = new Uint8Array(n);
  const rooms: Room[] = [];
  let coveredBoxes = 0;
  let coveredGoals = 0;
  for (let i = 0; i < n; i++) {
    if (level.wall[i] || hallway[i] || seen[i]) continue;
    // Flood-fill one component of floor outside the hallway.
    const comp: number[] = [];
    const q = [i];
    seen[i] = 1;
    while (q.length > 0) {
      const c = q.pop()!;
      comp.push(c);
      const x = c % w;
      const y = (c / w) | 0;
      const nbs = [
        x > 0 ? c - 1 : -1,
        x + 1 < w ? c + 1 : -1,
        y > 0 ? c - w : -1,
        y + 1 < h ? c + w : -1,
      ];
      for (const nb of nbs) {
        if (nb >= 0 && !level.wall[nb] && !hallway[nb] && !seen[nb]) {
          seen[nb] = 1;
          q.push(nb);
        }
      }
    }
    const compSet = new Set(comp);
    const boxes = level.boxes.filter((b) => compSet.has(b));
    if (boxes.length === 0) continue;
    const goals = [...level.goals].filter((g) => compSet.has(g));
    if (boxes.length !== goals.length) return null;
    // Door cells: component cells adjacent to a hallway floor cell.
    const doors = comp.filter((c) => {
      const x = c % w;
      const y = (c / w) | 0;
      const nbs = [
        x > 0 ? c - 1 : -1,
        x + 1 < w ? c + 1 : -1,
        y > 0 ? c - w : -1,
        y + 1 < h ? c + w : -1,
      ];
      return nbs.some((nb) => nb >= 0 && hallway[nb] && !level.wall[nb]);
    });
    if (doors.length !== 1) return null;
    const door = doors[0]!;
    const dx = door % w;
    const dy = (door / w) | 0;
    const entries = [
      dx > 0 ? door - 1 : -1,
      dx + 1 < w ? door + 1 : -1,
      dy > 0 ? door - w : -1,
      dy + 1 < h ? door + w : -1,
    ].filter((nb) => nb >= 0 && hallway[nb] && !level.wall[nb]);
    if (entries.length !== 1) return null;
    const floor = new Uint8Array(n);
    for (const c of comp) floor[c] = 1;
    rooms.push({ floor, entry: entries[0]!, door, goals, boxes });
    coveredBoxes += boxes.length;
    coveredGoals += goals.length;
  }
  if (rooms.length === 0 || rooms.length > 4) return null;
  if (coveredBoxes !== level.boxes.length) return null;
  if (coveredGoals !== level.goals.size) return null;
  return rooms;
}

function solveLevel(level: Level): string {
  const { w, h } = level;
  const n = w * h;
  const levelFloor = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!level.wall[i]) levelFloor[i] = 1;

  for (const rowMode of [true, false]) {
    const rooms = decompose(level, rowMode);
    if (!rooms) continue;
    // Solve every room unconstrained, then with the exit requirement.
    type Info = { room: Room; s0: Push[]; s1: Push[] | null; s0Moves: string; s1Moves: string | null };
    const infos: Info[] = [];
    let ok = true;
    for (const room of rooms) {
      const s0 = solveRoom(room, w, h, false);
      if (!s0) { ok = false; break; }
      const rep0 = replayPushes(room, s0, room.entry, w, h);
      if (!rep0) { ok = false; break; }
      // Can the player walk out through the door after s0?
      const blocked = new Uint8Array(n);
      for (const g of room.goals) blocked[g] = 1;
      const walkable = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (room.floor[i]) walkable[i] = 1;
      walkable[room.entry] = 1;
      const region = bfsRegion(rep0.endPlayer, walkable, blocked, n, w);
      let s1: Push[] | null = null;
      let s1Moves: string | null = null;
      if (region.region[room.door]) {
        s1 = s0;
        s1Moves = rep0.moves;
      } else {
        s1 = solveRoom(room, w, h, true);
        if (s1) {
          const rep1 = replayPushes(room, s1, room.entry, w, h);
          s1Moves = rep1 ? rep1.moves : null;
          if (!rep1) { ok = false; break; }
        }
      }
      infos.push({ room, s0, s1, s0Moves: rep0.moves, s1Moves });
    }
    if (!ok) continue;
    // Rooms that can never be exited must be solved last; among the
    // rest, the room whose exit costs the most pushes goes last.
    const mustLast = infos.filter((inf) => inf.s1 === null);
    if (mustLast.length > 1) continue;
    let lastIdx = -1;
    if (mustLast.length === 1) {
      lastIdx = infos.indexOf(mustLast[0]!);
    } else {
      let bestSaving = -1;
      infos.forEach((inf, idx) => {
        const saving = inf.s1!.length - inf.s0.length;
        if (saving > bestSaving) { bestSaving = saving; lastIdx = idx; }
      });
    }
    const order = infos.filter((_, idx) => idx !== lastIdx);
    order.push(infos[lastIdx]!);
    // Assemble: walk to each room's entry, run its solution.
    let player = level.player;
    const boxSet = new Set(level.boxes);
    let moves = '';
    let failed = false;
    for (let k = 0; k < order.length; k++) {
      const inf = order[k]!;
      const useExit = k < order.length - 1;
      const roomMoves = useExit ? inf.s1Moves : inf.s0Moves;
      if (roomMoves === null) { failed = true; break; }
      const blocked = new Uint8Array(n);
      for (const b of boxSet) blocked[b] = 1;
      const walk = bfsPath(player, inf.room.entry, levelFloor, blocked, n, w);
      if (walk === null) { failed = true; break; }
      moves += walk;
      moves += roomMoves;
      // Update state: the room's boxes end on its goals.
      const rep = replayPushes(
        inf.room,
        useExit ? inf.s1! : inf.s0,
        inf.room.entry,
        w,
        h,
      );
      if (!rep) { failed = true; break; }
      player = rep.endPlayer;
      for (const b of inf.room.boxes) boxSet.delete(b);
      for (const g of inf.room.goals) boxSet.add(g);
    }
    if (!failed) return moves;
  }

  // Fallback: one push-A* over the whole level.
  const whole: Room = {
    floor: levelFloor,
    entry: level.player,
    door: -1,
    goals: [...level.goals],
    boxes: level.boxes.slice(),
  };
  const sol = solveRoom(whole, w, h, false);
  if (!sol) return '';
  const rep = replayPushes(whole, sol, level.player, w, h);
  return rep ? rep.moves : '';
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
