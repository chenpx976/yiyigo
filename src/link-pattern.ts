import type { Link } from "./engine";

type Pattern = Pick<Link, "i" | "j" | "kind">;

/**
 * Integer intersections on each shortest orthogonal route between a recognized
 * local link's endpoints, excluding the endpoints themselves. These are geometric
 * alternatives, not proof that a player can connect under alternating play.
 * A diagonal has two one-point alternatives; a knight has three two-point ones.
 */
export function linkRoutes(n: number, link: Pattern): number[][] {
  if (link.kind === "solid") return [[]];
  const x0 = link.i % n, y0 = Math.floor(link.i / n);
  const x1 = link.j % n, y1 = Math.floor(link.j / n);
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  const routes: number[][] = [];
  const walk = (x: number, y: number, route: number[]) => {
    if (x === x1 && y === y1) {
      routes.push(route.slice(0, -1));
      return;
    }
    if (x !== x1) walk(x + sx, y, [...route, y * n + x + sx]);
    if (y !== y1) walk(x, y + sy, [...route, (y + sy) * n + x]);
  };
  walk(x0, y0, []);
  return routes;
}

/** Unique local route / intrusion points. Never samples fractional board indices. */
export function linkRoutePoints(n: number, link: Pattern): number[] {
  return [...new Set(linkRoutes(n, link).flat())];
}
