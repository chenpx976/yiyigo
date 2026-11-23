import type { Go, Link } from "./engine";

// This selector changes presentation only. The Go links and their liberties
// remain intact, and hidden links keep their transition state for restoration.
export function redundantJumps(
  game: Go,
  candidates: readonly Link[],
  strength: (link: Link) => number,
): Set<Link> {
  const hidden = new Set<Link>();
  const membership = new Map<number, number>();
  for (let p = 0; p < game.board.length; p++)
    if (game.board[p] && !membership.has(p))
      for (const stone of game.group(p).stones) membership.set(stone, p);
  const diagonals = candidates.filter(l => l.kind === "diagonal" && !l.threatened);

  for (const target of candidates) {
    if (target.kind !== "small" && target.kind !== "large" && target.kind !== "knight") continue;
    // A knight's geometric routes do not prove tactical connection, so it
    // cannot replace another displayed contact even when its tone is stronger.
    const stronger = (l: Link) => l.kind !== "knight" && l.color === target.color &&
      !l.threatened && strength(l) > strength(target) * 1.1;

    // Keep the symmetric four-diagonal outline when it already expresses a
    // three/four-stone arrangement. Never remove those diagonals themselves.
    if (target.kind === "small" && diagonals.some(a => {
      if (!stronger(a)) return false;
      const via = a.i === target.i ? a.j : a.j === target.i ? a.i : -1;
      return via >= 0 && diagonals.some(b => stronger(b) &&
        ((b.i === via && b.j === target.j) || (b.j === via && b.i === target.j)));
    })) {
      hidden.add(target);
      continue;
    }

    const ax = target.i % game.n, ay = Math.floor(target.i / game.n);
    const dx = target.j % game.n - ax;
    const dy = Math.floor(target.j / game.n) - ay;
    const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const inCorridor = (p: number) => {
      const x = p % game.n - ax, y = Math.floor(p / game.n) - ay;
      const along = x * ux + y * uy, across = x * uy - y * ux;
      return along >= 0 && along <= length && Math.abs(across) <= 1;
    };
    const solidDistance = (from: number, to: number) => {
      if (!inCorridor(to) || membership.get(from) !== membership.get(to)) return Infinity;
      const seen = new Set([from]), queue: [number, number][] = [[from, 0]];
      for (let q = 0; q < queue.length; q++) {
        const [p, distance] = queue[q];
        if (p === to) return distance;
        if (distance >= length) continue;
        for (const next of game.neighbors(p))
          if (!seen.has(next) && game.board[next] === target.color && inCorridor(next)) {
            seen.add(next);
            queue.push([next, distance + 1]);
          }
      }
      return Infinity;
    };
    // A stronger connection elsewhere on two large groups does not replace a
    // local route. Only a shorter contact within one grid of this same axis,
    // reached through at most `length` solid steps, can retire the weak jump.
    const covered = candidates.some(alternate => {
      if (alternate === target || alternate.kind === "solid" || !stronger(alternate)) return false;
      const alternateLength = Math.hypot(
        alternate.j % game.n - alternate.i % game.n,
        Math.floor(alternate.j / game.n) - Math.floor(alternate.i / game.n),
      );
      if (alternateLength >= length) return false;
      return Math.min(
        solidDistance(target.i, alternate.i) + solidDistance(target.j, alternate.j),
        solidDistance(target.i, alternate.j) + solidDistance(target.j, alternate.i),
      ) <= length;
    });
    if (covered) hidden.add(target);
  }
  return hidden;
}


export interface CrossingTarget {
  key: string;
  t: number;
  kind: "opposed";
}
export const connectionKey = (link: Link) => `${link.color}:${link.i}:${link.j}`;

// A geometric competition is not a tactical cut or an extra Go node. Only
// strictly interior intersections of opposite-colour visible candidates count.
export function opposedCrossings(game: Go, visible: readonly Link[]): Map<Link, CrossingTarget[]> {
  const result = new Map<Link, CrossingTarget[]>();
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (let a = 0; a < visible.length; a++) {
    const first = visible[a];
    if (first.kind === "solid") continue;
    const ax = first.i % game.n, ay = Math.floor(first.i / game.n);
    const rx = first.j % game.n - ax, ry = Math.floor(first.j / game.n) - ay;
    for (let b = a + 1; b < visible.length; b++) {
      const second = visible[b];
      if (second.kind === "solid" || first.color === second.color) continue;
      const bx = second.i % game.n, by = Math.floor(second.i / game.n);
      const sx = second.j % game.n - bx, sy = Math.floor(second.j / game.n) - by;
      const determinant = cross(rx, ry, sx, sy);
      if (Math.abs(determinant) < 1e-9) continue;
      const t = cross(bx - ax, by - ay, sx, sy) / determinant;
      const u = cross(bx - ax, by - ay, rx, ry) / determinant;
      if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
      const x = ax + rx * t, y = ay + ry * t;
      if (Math.abs(x - Math.round(x)) < 1e-9 && Math.abs(y - Math.round(y)) < 1e-9 &&
        game.board[Math.round(y) * game.n + Math.round(x)]) continue;
      const firstList = result.get(first) ?? [], secondList = result.get(second) ?? [];
      firstList.push({ key: connectionKey(second), t, kind: "opposed" });
      secondList.push({ key: connectionKey(first), t: u, kind: "opposed" });
      result.set(first, firstList);
      result.set(second, secondList);
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
  return result;
}

// Reveal only contacts incident to the actual focused block. A visual crossing
// never means either side owns the point: at rest both candidates yield; focus
// resolves only that local competition and leaves unrelated contacts alone.
export function hiddenConnections(
  game: Go,
  candidates: readonly Link[],
  strength: (link: Link) => number,
  focus = -1,
): Set<Link> {
  const hidden = redundantJumps(game, candidates, strength);
  // Knight relations often depend on ladders or acceptable sacrifices. Keep
  // their geometric candidates for inspection, without asserting a safe link.
  for (const link of candidates) if (link.kind === "knight") hidden.add(link);
  const group = game.board[focus] ? game.group(focus).stones : new Set<number>();
  const related = (link: Link) => group.has(link.i) || group.has(link.j);
  for (const link of candidates) if (related(link)) hidden.delete(link);
  const visible = candidates.filter(link => !hidden.has(link));
  const byKey = new Map(visible.map(link => [connectionKey(link), link]));
  for (const [link, conflicts] of opposedCrossings(game, visible)) {
    for (const conflict of conflicts) {
      const other = byKey.get(conflict.key)!;
      if (related(link)) hidden.add(other);
      else if (related(other)) hidden.add(link);
      else {
        hidden.add(link);
        hidden.add(other);
      }
    }
  }
  return hidden;
}
