import test from "node:test";
import assert from "node:assert/strict";
import { stoneProfile } from "../src/stone-profile";
import { Go } from "../src/engine";
import {
  surfaceModel,
  smoothUnion,
  capsuleDistance,
  solidRadius,
} from "../src/surface-model";
import { updateConnections } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";
function model(g: Go) {
  return surfaceModel(g, -1, [], false, 0, false, new Map());
}
function physicalDistance(g: Go, x: number, y: number) {
  return model(g)
    .primitives.filter((p) => p.data[4] < 2 && p.data[5] === 1)
    .reduce((d, p) => {
      const [ax, ay, bx, by, type] = p.data;
      return smoothUnion(
        d,
        type === 0
          ? Math.hypot(x - ax, y - ay) - stoneProfile.radius
          : capsuleDistance(x, y, ax, ay, bx, by, solidRadius),
      );
    }, 10);
}
test("coarse topology footprint keeps a broad real bridge (not a GPU seam test)", () => {
  const g = new Go(9);
  g.board[40] = g.board[41] = 1;
  for (let x = 4; x <= 5; x += 0.02) assert.ok(physicalDistance(g, x, 4.24) < 0);
  assert.ok(
    physicalDistance(g, 4.5, 4.35) > 0,
    "independent convex stone silhouette survives",
  );
  const h = 0.0001,
    x = 4.4,
    y = 4.2;
  const left = (physicalDistance(g, x, y) - physicalDistance(g, x - h, y)) / h;
  const right = (physicalDistance(g, x + h, y) - physicalDistance(g, x, y)) / h;
  assert.ok(Math.abs(left - right) < 0.01, "coarse footprint has continuous slope");
});
test("corner, T, cross and ring junctions preserve grid topology and empty eyes", () => {
  for (const stones of [
    [40, 41, 49],
    [40, 39, 41, 49],
    [40, 39, 41, 31, 49],
  ]) {
    const g = new Go(9);
    for (const p of stones) g.board[p] = 1;
    assert.ok(physicalDistance(g, 4, 4) < 0);
    assert.ok(
      physicalDistance(g, 4.5, 4.5) > 0,
      "diagonal empty corner is not flooded",
    );
  }
  const g = new Go(9);
  for (const p of [30, 31, 32, 39, 41, 48, 49, 50]) g.board[p] = 1;
  assert.ok(
    physicalDistance(g, 4, 4) > 0,
    "surrounded empty point remains visible; this does not prove life",
  );
});
test("virtual to real connection changes topology, and capture leaves no orphan strand", () => {
  const g = new Go(9);
  g.board[40] = g.board[42] = 1;
  const states = new Map<string, ConnectionState>();
  updateConnections(g, states, 0, false);
  g.board[41] = 1;
  let result = surfaceModel(g, -1, [], true, 1, true, states);
  assert.equal(result.primitives.filter((p) => p.data[4] === 1).length, 2);
  assert.ok([...states.values()].every((s) => s.to[0] === 0));
  g.board[40] = 0;
  result = surfaceModel(g, -1, [], true, 1.1, true, states);
  assert.equal(result.primitives.filter((p) => p.data[4] === 2).length, 0);
});
test("spatial bins do not omit primitive support at tile borders or mix colors", () => {
  const g = new Go(19);
  for (let i = 0; i < g.board.length; i++)
    if (i % 3 !== 0) g.board[i] = i % 2 ? 1 : 2;
  const { primitives, bins } = model(g);
  for (let i = 0; i < bins.length; i++)
    for (let k = 0; k < primitives.length; k++) {
      const [l, t, r, b] = primitives[k].bounds,
        x = i % 19,
        y = Math.floor(i / 19);
      if (l <= x + 0.5 && r >= x - 0.5 && t <= y + 0.5 && b >= y - 0.5)
        assert.ok(bins[i].includes(k));
    }
  assert.ok(primitives.every((p) => p.data.length === 20));
  assert.ok(
    primitives.some((p) => p.data[5] === 1) &&
      primitives.some((p) => p.data[5] === 2),
  );
});

test('atari never thins real bridges, and opposing neighbours never get a bridge',()=>{
 const g=new Go(9);g.board[40]=g.board[41]=1;
 for(const p of [31,32,39,49,50])g.board[p]=2;
 assert.equal(g.group(40).liberties.size,1);
 assert.ok(physicalDistance(g,4.5,4.20)<0,'atari still has a broad connection');
 assert.ok(model(g).primitives.filter(p=>p.data[4]===1).every(p=>{
  const [ax,ay,bx,by]=p.data;return g.board[ay*9+ax]===g.board[by*9+bx];
 }));
});
