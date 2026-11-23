import { Go, links } from "./engine";
import type { Cell } from "./engine";
import { groups } from "./position";
import { updateConnections, connectionDuration } from "./connection-state";
import type { ConnectionState } from "./connection-state";
import { updateSurfaces, morphDuration } from "./surface-transition";
import type { SurfaceTransition, SurfaceTarget } from "./surface-transition";
export interface SurfacePrimitive {
  data: number[];
  bounds: [number, number, number, number];
}
export const surfaceBlend = 0.12;
export const solidRadius = 0.27;
export function smoothUnion(a: number, b: number, k = surfaceBlend) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function capsuleDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - r;
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
    if (state.to === 0 && time-state.start >= morphDuration) surfaces.delete(key);
  for (const [key,state] of connections)
    if (!activeConnections.has(key) && state.to[0] === 0 && time-state.start >= connectionDuration)
      connections.delete(key);
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
) {
  const n = game.n,
    primitives: SurfacePrimitive[] = [];
  const members = new Map<number, { lib: number; seed: number }>();
  for (const group of groups(game))
    for (const p of group.stones)
      members.set(p, { lib: group.liberties.size, seed: group.anchor * 0.23 });
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
  ) => {
    const ax = i % n,
      ay = Math.floor(i / n),
      bx = j % n,
      by = Math.floor(j / n);
    primitives.push({
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
  const currentLinks = links(game);
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
    updateConnections(game, connections, time, false);
  } else if (mode === "retarget") {
    updateSurfaces(targets, surfaces, time, true);
    updateConnections(game, connections, time, true);
  } else {
    pruneRetiredStates(
      connections,
      surfaces,
      new Set(currentLinks.filter(l => l.kind !== "solid").map(l => `${l.color}:${l.i}:${l.j}`)),
      time,
    );
  }
  for (const state of surfaces.values()) {
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
      game.board[p] === state.link.color ||
      [...surfaces.values()].some(
        (s) => s.type === 0 && s.i === p && s.color === state.link.color,
      );
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
    );
  }
  // A connected stone now owns the material up to the midpoint of each pull.
  // Extend its spatial support; links themselves are constraints, not solids.
  for (const node of primitives) {
    if (node.data[4] !== 0) continue;
    const [x,y] = node.data;
    for (const link of primitives) {
      if (link.data[4] === 0 || link.data[5] !== node.data[5]) continue;
      const [ax,ay,bx,by] = link.data;
      if (!((x===ax && y===ay)||(x===bx && y===by))) continue;
      const mx=(ax+bx)/2, my=(ay+by)/2;
      node.bounds[0]=Math.min(node.bounds[0],mx-.65);
      node.bounds[1]=Math.min(node.bounds[1],my-.65);
      node.bounds[2]=Math.max(node.bounds[2],mx+.65);
      node.bounds[3]=Math.max(node.bounds[3],my+.65);
    }
  }
  // Each tile evaluates every primitive whose smooth-union support intersects it.
  // Adjacent tiles share primitives near their boundary; no fixed cap drops complex junctions.
  const bins = Array.from({ length: n * n }, (_, i) =>
    primitives.flatMap((p, k) => {
      const x = i % n,
        y = Math.floor(i / n),
        [l, t, r, b] = p.bounds;
      return l <= x + 0.5 && r >= x - 0.5 && t <= y + 0.5 && b >= y - 0.5
        ? [k]
        : [];
    }),
  );
  return { primitives, bins };
}
