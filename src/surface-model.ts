import type { Go, Cell } from "./engine";
import { updateConnections, connectionDuration, analyzeConnections } from "./connection-state";
import type { ConnectionState, ConnectionCrossing, ConnectionAnalysis } from "./connection-state";
import { updateSurfaces, morphDuration } from "./surface-transition";
import type { SurfaceTransition, SurfaceTarget } from "./surface-transition";
export interface SurfacePrimitive {
  data: number[];
  bounds: [number, number, number, number];
  crossings?: ConnectionCrossing[];
}
export interface SurfaceModel {
  primitives: SurfacePrimitive[];
  bins: number[][];
}
export type SurfaceUpdateMode = "reset" | "retarget" | "sample";

// A target board is already stored explicitly by active node transitions.
// Re-reading that board samples animation; a different non-animated board is
// a seek/reset. No hidden cache, frame counter or object identity is involved.
export function surfaceUpdateMode(
  game: Go,
  surfaces: Map<string, SurfaceTransition>,
  animate: boolean,
  motion: boolean,
): SurfaceUpdateMode {
  if (!motion) return "reset";
  if (animate) return "retarget";
  const active = [...surfaces.values()].filter(s => s.type === 0 && s.to === 1);
  if (active.length !== game.board.filter(Boolean).length) return "reset";
  return active.every(s => game.board[s.i] === s.color) ? "sample" : "reset";
}

// Sampling may remove finished, inactive records, but must never change a
// surviving record's origin or clock. Hidden active links remain cached.
function pruneRetiredStates(
  connections: Map<string, ConnectionState>,
  surfaces: Map<string, SurfaceTransition>,
  activeConnections: Set<string>,
  time: number,
) {
  for (const [key,state] of surfaces)
    if (state.to === 0 && time >= state.start + morphDuration) surfaces.delete(key);
  for (const [key,state] of connections) {
    if (!activeConnections.has(key) && state.to[0] === 0 && time >= state.start + connectionDuration)
      connections.delete(key);
    else if (state.crossings?.some(c => c.to === 0 && time >= c.start + connectionDuration))
      state.crossings = state.crossings.filter(c => c.to !== 0 || time < c.start + connectionDuration);
  }
}

export function surfaceModel(
  game: Go,
  selected: number,
  previous: Cell[],
  animate: boolean,
  time: number,
  motion: boolean,
  connections: Map<string, ConnectionState>,
  surfaces: Map<string, SurfaceTransition> = new Map(),
  mode: SurfaceUpdateMode = surfaceUpdateMode(game, surfaces, animate, motion),
  analysis: ConnectionAnalysis = analyzeConnections(game),
): SurfaceModel {
  const n = game.n,
    primitives: SurfacePrimitive[] = [];
  const { members, currentLinks } = analysis;
  const add = (
    i: number,
    j: number,
    type: number,
    color: number,
    lib: number,
    seed: number,
    from: number[],
    to: number[],
    start = -100,
    cut = 0.5,
    merging = 0,
    cutFrom = cut,
    crossings?: ConnectionCrossing[],
  ) => {
    const ax = i % n,
      ay = Math.floor(i / n),
      bx = j % n,
      by = Math.floor(j / n);
    primitives.push({
      crossings,
      data: [
        ax,
        ay,
        bx,
        by,
        type,
        color,
        lib,
        seed,
        ...from,
        ...to,
        start,
        cut,
        merging,
        type===2 ? cutFrom : Number(i === selected),
      ],
      bounds: [
        Math.min(ax, bx) - 0.7,
        Math.min(ay, by) - 0.7,
        Math.max(ax, bx) + 0.7,
        Math.max(ay, by) + 0.7,
      ],
    });
  };
  const targets: SurfaceTarget[] = [];
  game.board.forEach((color, i) => {
    if (color) {
      const m = members.get(i)!;
      targets.push({ i, j: i, type: 0, color, lib: m.lib, seed: m.seed });
    }
  });
  for (const link of currentLinks)
    if (link.kind === "solid") {
      const m = members.get(link.i)!;
      targets.push({
        i: link.i,
        j: link.j,
        type: 1,
        color: link.color,
        lib: m.lib,
        seed: m.seed,
      });
    }
  if (mode === "reset") {
    surfaces.clear();
    connections.clear();
    updateSurfaces(targets, surfaces, time, false);
    updateConnections(game, connections, time, false, selected, analysis);
  } else if (mode === "retarget") {
    updateSurfaces(targets, surfaces, time, true);
    updateConnections(game, connections, time, true, selected, analysis);
  } else {
    // Focus changes only connection visibility; unchanged targets keep their clocks.
    updateConnections(game, connections, time, true, selected, analysis);
    pruneRetiredStates(
      connections,
      surfaces,
      new Set(currentLinks.filter(l => l.kind !== "solid").map(l => `${l.color}:${l.i}:${l.j}`)),
      time,
    );
  }
  const visibleEndpoints = new Set<number>();
  for (const state of surfaces.values()) {
    if (state.type === 0) visibleEndpoints.add(state.color * n * n + state.i);
    add(
      state.i,
      state.j,
      state.type,
      state.color,
      state.lib,
      state.seed,
      [state.from, 0, 0, 0],
      [state.to, 0, 0, 0],
      state.start,
    );
  }
  for (const state of connections.values()) {
    // Retiring strands stay attached while their endpoints shrink in this same surface.
    const endpointVisible = (p: number) =>
      game.board[p] === state.link.color || visibleEndpoints.has(state.link.color * n * n + p);
    if (!endpointVisible(state.link.i) || !endpointVisible(state.link.j))
      continue;
    const { i, j, color } = state.link;
    add(
      i,
      j,
      2,
      color,
      0,
      i * 0.3,
      // The GPU's third tone component is visibility, not tactical threat.
      [state.from[0],state.from[1],state.fromVisibility??Number(state.from[0]>0),state.from[3]],
      [state.to[0],state.to[1],state.toVisibility??Number(state.to[0]>0),state.to[3]],
      state.start,
      state.cut,
      Number(state.merging ?? false),
      state.cutFrom ?? state.cut,
      state.crossings,
    );
  }
  // Each edge owns its entire connection volume and keeps its full bounds.
  // Endpoint lifecycle records are globally addressable; body bounds only need
  // to cover the fixed stone. No half-edge support or smooth-union halo remains.
  const bins: number[][] = Array.from({ length: n * n }, () => []);
  for (let k = 0; k < primitives.length; k++) {
    const [l, t, r, b] = primitives[k].bounds;
    const left = Math.max(0, Math.ceil(l - 0.5));
    const right = Math.min(n - 1, Math.floor(r + 0.5));
    const top = Math.max(0, Math.ceil(t - 0.5));
    const bottom = Math.min(n - 1, Math.floor(b + 0.5));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) bins[y * n + x].push(k);
  }
  return { primitives, bins };
}
